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
        handleKeyShareRequest(message, sender).then(sendResponse)
        return true // Keep channel open for async response
    }

    if (message.type === "KEY_GET_PENDING_REQUEST") {
        // Used by popup to get current pending request
        const pending = Array.from(pendingKeyRequests.values())[0]
        sendResponse({ request: pending || null })
    }

    if (message.type === "KEY_APPROVAL_RESULT") {
        handleKeyApprovalResult(message.requestId, message.approved, message.encryptedData)
        sendResponse({ success: true })
    }

    return true // allow async sendResponse
})

async function handleKeyShareRequest(
    message: { origin: string; requestId: string },
    sender: chrome.runtime.MessageSender
): Promise<EncryptedKeyResponse> {
    // Check if wallet is unlocked
    const now = Date.now()
    if (!decryptedMnemonic || now >= unlockUntil) {
        return { success: false, error: 'Wallet is locked. Please unlock your wallet first.' }
    }

    // Create pending request
    const request: PendingKeyRequest = {
        id: message.requestId,
        origin: message.origin,
        timestamp: Date.now(),
        tabId: sender.tab?.id || 0
    }

    pendingKeyRequests.set(request.id, request)

    // Open popup for approval
    return new Promise((resolve) => {
        // Store resolve function for later
        request.resolve = resolve
        pendingKeyRequests.set(request.id, request)

        // Open popup window for approval
        chrome.windows.create({
            url: chrome.runtime.getURL('popup.html?keyshare=' + request.id),
            type: 'popup',
            width: 400,
            height: 600,
            focused: true
        })
    })
}

function handleKeyApprovalResult(
    requestId: string,
    approved: boolean,
    encryptedData?: { salt: number[]; iv: number[]; cipherText: number[]; address: string; publicKey: string }
) {
    const request = pendingKeyRequests.get(requestId)
    if (!request || !request.resolve) return

    if (approved && encryptedData) {
        request.resolve({
            success: true,
            salt: encryptedData.salt,
            iv: encryptedData.iv,
            cipherText: encryptedData.cipherText,
            address: encryptedData.address,
            publicKey: encryptedData.publicKey
        })
    } else {
        request.resolve({ success: false, error: 'User rejected the request' })
    }

    pendingKeyRequests.delete(requestId)
}

// Clean up stale requests (older than 5 minutes)
setInterval(() => {
    const now = Date.now()
    const FIVE_MINUTES = 5 * 60 * 1000

    pendingKeyRequests.forEach((request, id) => {
        if (now - request.timestamp > FIVE_MINUTES) {
            if (request.resolve) {
                request.resolve({ success: false, error: 'Request expired' })
            }
            pendingKeyRequests.delete(id)
        }
    })
}, 60000)
