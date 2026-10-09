// background.ts

import type { PendingKeyRequest, EncryptedKeyResponse } from "~types/auth"
import { checkKeyShareOrigin } from "~lib/keyShareOrigins"
import { ConnectionStore } from "~lib/provider/connections"
import { ProviderHandler } from "~lib/provider/handler"
import { ProviderRequestQueue } from "~lib/provider/requests"
import { getNetwork } from "~lib/secureStorage"
import { createAccountFromSecret } from "~lib/utils"

let decryptedMnemonic: string | null = null
let unlockUntil: number = 0

const UNLOCK_DURATION_MS = 5 * 60 * 1000 // 5 minutes

// === Provider (window.verifiedX) State ===
const providerQueue = new ProviderRequestQueue()
const provider = new ProviderHandler({
    queue: providerQueue,
    connections: new ConnectionStore(chrome.storage.local),
    unlockedKey: () => (decryptedMnemonic !== null && Date.now() < unlockUntil ? decryptedMnemonic : null),
    activeNetwork: getNetwork,
    deriveAccount: (network, privateKey) => {
        const account = createAccountFromSecret(network, privateKey)
        return { address: account.address, publicKey: account.public, network }
    },
    openApprovalWindow: (requestId) =>
        new Promise((resolve, reject) => {
            chrome.windows.create({
                url: chrome.runtime.getURL('popup.html?request=' + encodeURIComponent(requestId)),
                type: 'popup',
                width: 400,
                height: 640,
                focused: true
            }, (created) => {
                if (chrome.runtime.lastError || !created?.id) {
                    reject(new Error(chrome.runtime.lastError?.message ?? 'No window'))
                    return
                }
                resolve(created.id)
            })
        })
})

// === Key Share State ===
const pendingKeyRequests: Map<string, PendingKeyRequest> = new Map()

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "UNLOCK_WALLET") {
        decryptedMnemonic = message.mnemonic
        unlockUntil = Date.now() + UNLOCK_DURATION_MS
        sendResponse({ success: true })
    }

    if (message.type === "IS_UNLOCKED") {
        const now = Date.now()
        const unlocked = decryptedMnemonic !== null && now < unlockUntil
        sendResponse({ unlocked })
    }

    if (message.type === "GET_MNEMONIC") {
        const now = Date.now()
        if (decryptedMnemonic !== null && now < unlockUntil) {
            sendResponse({ mnemonic: decryptedMnemonic })
        } else {
            sendResponse({ mnemonic: null })
        }
    }

    if (message.type === "LOCK_WALLET") {
        decryptedMnemonic = null
        unlockUntil = 0
        sendResponse({ success: true })
    }

    if (message.type === "RESET_UNLOCK_TIMER") {
        if (decryptedMnemonic) {
            unlockUntil = Date.now() + 5 * 60 * 1000 // extend unlock 5 min
        }
        sendResponse({ success: true })
    }

    // === Provider Message Handlers ===

    if (message.type === "PROVIDER_REQUEST") {
        // Only content scripts in a tab can ask; the origin comes from the
        // browser, not from the message.
        const origin = senderOrigin(sender)
        if (sender.id !== chrome.runtime.id || !sender.tab || !origin || isExtensionPage(sender) || !/^https?:\/\//.test(origin)) {
            sendResponse({ ok: false, error: { code: -32603, message: 'Invalid request' } })
            return
        }
        provider
            .handleRequest({ origin, tabId: sender.tab.id ?? 0 }, message.method, message.params)
            .then(sendResponse)
        return true
    }

    if (message.type === "PROVIDER_GET_REQUEST") {
        // Used by the approval popup to load the one request it was opened for
        sendResponse({ request: isExtensionPage(sender) ? providerQueue.view(message.requestId) : null })
        return
    }

    if (message.type === "PROVIDER_APPROVAL_RESULT") {
        if (!isExtensionPage(sender)) {
            sendResponse({ success: false })
            return
        }
        const outcome = message.outcome === "approved"
            ? { outcome: "approved" as const, result: message.result }
            : message.outcome === "failed"
                ? { outcome: "failed" as const, message: String(message.message ?? "") }
                : { outcome: "rejected" as const }
        provider.handleApproval(message.requestId, outcome).then((success) => sendResponse({ success }))
        return true
    }

    if (message.type === "PROVIDER_CLEAR_CONNECTIONS") {
        if (!isExtensionPage(sender)) {
            sendResponse({ success: false })
            return
        }
        provider.clearConnections().then(() => sendResponse({ success: true }))
        return true
    }

    // === Key Share Message Handlers ===

    if (message.type === "KEY_SHARE_REQUEST") {
        handleKeyShareRequest(sender).then(sendResponse)
        return true // Keep channel open for async response
    }

    if (message.type === "KEY_GET_PENDING_REQUEST") {
        // Used by the approval popup to load the one request it was opened for
        if (!isExtensionPage(sender)) {
            sendResponse({ request: null })
            return
        }
        const pending = getLiveRequest(message.requestId)
        sendResponse({
            request: pending
                ? { id: pending.id, origin: pending.origin, network: pending.network, timestamp: pending.timestamp, tabId: pending.tabId }
                : null
        })
    }

    if (message.type === "KEY_APPROVAL_RESULT") {
        if (!isExtensionPage(sender)) {
            sendResponse({ success: false })
            return
        }
        handleKeyApprovalResult(message.requestId, message.approved, message.encryptedData).then((handled) =>
            sendResponse({ success: handled })
        )
        return true
    }

    return true // allow async sendResponse
})

const KEY_REQUEST_TTL_MS = 5 * 60 * 1000

// Popup and other extension pages; content scripts carry the page's URL.
function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
    return sender.id === chrome.runtime.id && (sender.url ?? "").startsWith(chrome.runtime.getURL(""))
}

function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
    if (sender.origin) return sender.origin
    try {
        return sender.url ? new URL(sender.url).origin : null
    } catch {
        return null
    }
}

function getLiveRequest(requestId: unknown): PendingKeyRequest | null {
    if (typeof requestId !== "string") return null
    const request = pendingKeyRequests.get(requestId)
    if (!request) return null
    if (Date.now() - request.timestamp > KEY_REQUEST_TTL_MS) {
        settleRequest(request, { success: false, error: 'Request expired' })
        return null
    }
    return request
}

function settleRequest(request: PendingKeyRequest, result: EncryptedKeyResponse) {
    pendingKeyRequests.delete(request.id)
    request.resolve?.(result)
}

async function handleKeyShareRequest(sender: chrome.runtime.MessageSender): Promise<EncryptedKeyResponse> {
    // Only content scripts in a tab can ask; the origin comes from the
    // browser, not from the message.
    const origin = senderOrigin(sender)
    if (sender.id !== chrome.runtime.id || !sender.tab || !origin) {
        return { success: false, error: 'Invalid request' }
    }

    // Only the VerifiedX web wallet, and only for its own network. Anyone
    // else is refused here, before a popup opens.
    const allowed = checkKeyShareOrigin(origin, await getNetwork())
    if (!allowed.ok) {
        return { success: false, error: allowed.error }
    }

    // Check if wallet is unlocked
    const now = Date.now()
    if (!decryptedMnemonic || now >= unlockUntil) {
        return { success: false, error: 'Wallet is locked. Please unlock your wallet first.' }
    }

    for (const existing of pendingKeyRequests.values()) {
        if (existing.origin === origin && getLiveRequest(existing.id)) {
            return { success: false, error: 'A key request from this site is already waiting for approval' }
        }
    }

    // The id is generated here so a page cannot choose or collide with
    // another request's id. The approval popup is bound to it.
    const request: PendingKeyRequest = {
        id: crypto.randomUUID(),
        origin,
        network: allowed.network,
        timestamp: now,
        tabId: sender.tab.id ?? 0
    }

    return new Promise((resolve) => {
        request.resolve = resolve
        pendingKeyRequests.set(request.id, request)

        chrome.windows.create({
            url: chrome.runtime.getURL('popup.html?keyshare=' + encodeURIComponent(request.id)),
            type: 'popup',
            width: 400,
            height: 600,
            focused: true
        }, (created) => {
            if (chrome.runtime.lastError || !created?.id) {
                settleRequest(request, { success: false, error: 'Could not open the approval window' })
                return
            }
            request.windowId = created.id
        })
    })
}

// Closing the approval window without answering rejects its request.
chrome.windows.onRemoved.addListener((windowId) => {
    providerQueue.windowClosed(windowId)
    pendingKeyRequests.forEach((request) => {
        if (request.windowId === windowId) {
            settleRequest(request, { success: false, error: 'User rejected the request' })
        }
    })
})

async function handleKeyApprovalResult(
    requestId: string,
    approved: boolean,
    encryptedData?: { salt: number[]; iv: number[]; cipherText: number[]; address: string; publicKey: string }
): Promise<boolean> {
    const request = getLiveRequest(requestId)
    if (!request) return false

    if (approved && encryptedData) {
        // The key handed over must be the one for the origin's network: the
        // extension must still be on that network, and the address must be
        // that network's address for the unlocked key.
        const key = decryptedMnemonic !== null && Date.now() < unlockUntil ? decryptedMnemonic : null
        const activeNetwork = await getNetwork()
        const expected = key && activeNetwork === request.network ? createAccountFromSecret(request.network, key) : null
        if (!expected || encryptedData.address !== expected.address) {
            settleRequest(request, { success: false, error: 'The wallet is not on this site\'s network' })
            return true
        }
        settleRequest(request, {
            success: true,
            salt: encryptedData.salt,
            iv: encryptedData.iv,
            cipherText: encryptedData.cipherText,
            address: encryptedData.address,
            publicKey: encryptedData.publicKey
        })
    } else {
        settleRequest(request, { success: false, error: 'User rejected the request' })
    }
    return true
}

// Clean up stale requests
setInterval(() => {
    providerQueue.sweep()
    pendingKeyRequests.forEach((request) => getLiveRequest(request.id))
}, 60000)
