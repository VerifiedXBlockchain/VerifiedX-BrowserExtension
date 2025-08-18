import { useState } from "react"
import { decryptMnemonic } from "~lib/secureStorage"
import { Network } from "~types/types"

interface PasswordPromptProps {
    network: Network
    isOpen: boolean
    onClose: () => void
    onSuccess: (mnemonic: string) => void
}

export default function PasswordPrompt({ network, isOpen, onClose, onSuccess }: PasswordPromptProps) {
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        try {
            const mnemonic = await decryptMnemonic(password, network)
            onSuccess(mnemonic)
            setPassword("")
            onClose()
        } catch (err) {
            console.error(err)
            setError("Incorrect password, please try again.")
        } finally {
            setLoading(false)
        }
    }

    const handleClose = () => {
        setPassword("")
        setError("")
        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
            <div className="bg-black w-full max-w-96 p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-white">Enter Password</h2>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-1">
                    <div>
                        <p className="text-sm text-gray-400 mb-3">
                            Enter your wallet password to export the private key.
                        </p>
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            autoFocus
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-zinc-800 border border-zinc-600 text-white p-3 rounded focus:outline-none focus:border-blue-500"
                        />
                    </div>

                    <div>
                        {error && <p className="text-red-400 text-sm">{error}</p>}
                    </div>

                    <div className="flex space-x-3 pt-1">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white p-3 rounded-lg transition-colors font-semibold"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || password.length === 0}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-lg transition disabled:bg-zinc-600 font-semibold"
                        >
                            {loading ? "Verifying..." : "Confirm"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}