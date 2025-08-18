import { useState } from "react"
import { encryptMnemonic } from "~lib/secureStorage"
import { validatePrivateKey, privateKeyToAccount } from "~lib/utils"
import type { Network, Account } from "~types/types"

interface ImportPrivateKeyProps {
    network: Network
    password: string
    onSuccess: (account: Account) => void
    onBack: () => void
}

export default function ImportPrivateKey({ network, password, onSuccess, onBack }: ImportPrivateKeyProps) {
    const [privateKey, setPrivateKey] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleImport = async () => {
        setError("")

        const cleanKey = privateKey.trim()
        
        if (!validatePrivateKey(cleanKey)) {
            setError("Invalid private key. Must be 64 hex characters.")
            return
        }

        setLoading(true)

        try {
            // Create account from private key
            const account = privateKeyToAccount(network, cleanKey)

            // Store the private key as a "mnemonic" for the wallet system
            // This allows it to work with the existing encryption/unlock flow
            await encryptMnemonic(cleanKey, password, network)

            // Unlock in background memory
            await chrome.runtime.sendMessage({
                type: "UNLOCK_WALLET",
                mnemonic: cleanKey
            })

            onSuccess(account)
        } catch (err) {
            console.error(err)
            setError("Failed to import private key. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col p-6 space-y-6 min-w-[320px] text-white">
            <h1 className="text-2xl font-light text-center">Import Private Key</h1>

            <div className="flex flex-col space-y-4">
                <div>
                    <label className="block text-sm text-gray-400 mb-2">
                        Private Key
                    </label>
                    <textarea
                        placeholder="Enter your private key (64 hex characters)"
                        value={privateKey}
                        autoFocus
                        onChange={(e) => setPrivateKey(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Example: 1a2b3c4d5e6f... (64 characters)
                    </p>
                </div>

                {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                <div className="flex space-x-3">
                    <button
                        onClick={onBack}
                        className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white p-3 rounded-lg transition-colors font-medium"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleImport}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-lg transition-colors font-semibold disabled:bg-blue-400"
                        disabled={loading || !privateKey.trim()}
                    >
                        {loading ? "Importing..." : "Import Wallet"}
                    </button>
                </div>
            </div>
        </div>
    )
}