
import { useState } from "react"
import { decryptMnemonic } from "~lib/secureStorage"
import { mnemonicToAccount } from "~lib/utils";
import type { Account, Network } from "~types/types";

interface UnlockProps {
    network: Network;
    onUnlockSuccess: (account: Account) => void
}

export default function Unlock({ network, onUnlockSuccess }: UnlockProps) {
    const [password, setPassword] = useState("younotry")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleUnlock = async () => {
        setError("")
        setLoading(true)

        try {

            const mnemonic = await decryptMnemonic(password)

            await chrome.runtime.sendMessage({
                type: "UNLOCK_WALLET",
                mnemonic: mnemonic
            })

            const account = mnemonicToAccount(network, mnemonic, 0);

            onUnlockSuccess(account)
        } catch (err) {
            console.error(err)
            setError("Incorrect password, please try again.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col p-6 space-y-6   text-white">
            <h1 className="text-2xl font-light text-center">Unlock Your Wallet</h1>

            <input
                type="password"
                placeholder="Password"
                value={password}
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
                onClick={handleUnlock}
                className="bg-blue-600 hover:bg-blue-500 transition text-white p-3 rounded font-semibold disabled:bg-blue-400"
                disabled={loading || password.length === 0}
            >
                {loading ? "Unlocking..." : "Unlock Wallet"}
            </button>
        </div>
    )
}
