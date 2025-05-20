
import { useState, useEffect, useCallback } from "react"
import { decryptMnemonic } from "~lib/secureStorage"

export function useWalletSession() {
    const [isUnlocked, setIsUnlocked] = useState(false)
    const [mnemonic, setMnemonic] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    const refreshSession = useCallback(async () => {
        try {
            const { unlocked } = await chrome.runtime.sendMessage({ type: "IS_UNLOCKED" })
            setIsUnlocked(unlocked)

            if (unlocked) {
                const { mnemonic } = await chrome.runtime.sendMessage({ type: "GET_MNEMONIC" })
                setMnemonic(mnemonic)
            } else {
                setMnemonic(null)
            }
        } catch (err) {
            console.error("Failed to refresh wallet session:", err)
            setIsUnlocked(false)
            setMnemonic(null)
        } finally {
            setLoading(false)
        }
    }, [])

    const unlock = useCallback(async (password: string) => {
        try {
            const decrypted = await decryptMnemonic(password)

            await chrome.runtime.sendMessage({
                type: "UNLOCK_WALLET",
                mnemonic: decrypted
            })

            await refreshSession()
            return true
        } catch (err) {
            console.error("Unlock failed:", err)
            return false
        }
    }, [refreshSession])

    const lock = useCallback(async () => {
        try {
            await chrome.runtime.sendMessage({ type: "LOCK_WALLET" })
            await refreshSession()
        } catch (err) {
            console.error("Lock failed:", err)
        }
    }, [refreshSession])

    useEffect(() => {
        refreshSession()
    }, [refreshSession])

    return {
        isUnlocked,
        mnemonic,
        loading,
        unlock,
        lock,
        refreshSession
    }
}