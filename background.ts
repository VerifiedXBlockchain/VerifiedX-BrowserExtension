// background.ts

import type { PendingKeyRequest, EncryptedKeyResponse } from "~types/auth"

let decryptedMnemonic: string | null = null
let unlockUntil: number = 0

const UNLOCK_DURATION_MS = 5 * 60 * 1000 // 5 minutes

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
                ? { id: pending.id, origin: pending.origin, timestamp: pending.timestamp, tabId: pending.tabId }
                : null
        })
    }

    if (message.type === "KEY_APPROVAL_RESULT") {
        if (!isExtensionPage(sender)) {
            sendResponse({ success: false })
            return
        }
        const handled = handleKeyApprovalResult(message.requestId, message.approved, message.encryptedData)
        sendResponse({ success: handled })
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
    pendingKeyRequests.forEach((request) => {
        if (request.windowId === windowId) {
            settleRequest(request, { success: false, error: 'User rejected the request' })
        }
    })
})

function handleKeyApprovalResult(
    requestId: string,
    approved: boolean,
    encryptedData?: { salt: number[]; iv: number[]; cipherText: number[]; address: string; publicKey: string }
): boolean {
    const request = getLiveRequest(requestId)
    if (!request) return false

    if (approved && encryptedData) {
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
    pendingKeyRequests.forEach((request) => getLiveRequest(request.id))
}, 60000)
