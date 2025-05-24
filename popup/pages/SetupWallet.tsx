import { useState } from "react"
import { encryptMnemonic } from "~lib/secureStorage"
import type { Network } from "~types/types"

interface Props {
    network: Network
    onCreate: (createdMnemonic: string) => void
}

export default function SetupWallet({ network, onCreate }: Props) {
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleCreateWallet = async () => {
        setError("")

        if (password.length < 8) {
            setError("Password must be at least 8 characters.")
            return
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match.")
            return
        }

        setLoading(true)

        try {
            const client = new window.vfx.VfxClient(network)

            const mnemonic = client.generateMnemonic(24)

            // Step 1: Encrypt and store the mnemonic securely
            await encryptMnemonic(mnemonic, password, network)

            // Step 2: (Optional) Immediately unlock in background memory
            await chrome.runtime.sendMessage({
                type: "UNLOCK_WALLET",
                mnemonic: mnemonic
            })

            // Step 3: Notify parent flow
            onCreate(mnemonic)
        } catch (err) {
            console.error(err)
            setError("Something went wrong. Try again.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col p-6 space-y-6 min-w-[320px] text-white">
            <h1 className="text-2xl font-light text-center">Create Your Wallet</h1>

            <div className="flex flex-col space-y-4">
                <input
                    type="password"
                    placeholder="New password"
                    value={password}
                    autoFocus
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                    type="password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                <button
                    onClick={handleCreateWallet}
                    className="bg-blue-600 hover:bg-blue-500 transition text-white p-3 rounded font-semibold disabled:bg-blue-400"
                    disabled={loading}
                >
                    {loading ? "Creating..." : "Create Wallet"}
                </button>
            </div>
        </div>
    )
}
