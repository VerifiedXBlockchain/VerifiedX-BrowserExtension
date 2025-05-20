// background.ts

let decryptedMnemonic: string | null = null
let unlockUntil: number = 0

const UNLOCK_DURATION_MS = 5 * 60 * 1000 // 5 minutes

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

    return true // allow async sendResponse
})
