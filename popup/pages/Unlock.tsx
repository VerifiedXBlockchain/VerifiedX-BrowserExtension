
import { useState } from "react"
import { decryptPrivateKey } from "~lib/secureStorage"
import { createAccountFromSecret } from "~lib/utils";
import { Network, type Account } from "~types/types";

interface UnlockProps {
    network: Network;
    onUnlockSuccess: (account: Account) => void
}

export default function Unlock({ network, onUnlockSuccess }: UnlockProps) {
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("")
        setLoading(true)

        try {
            // Try to decrypt from current network first, then fallback to other network
            let privateKey: string;
            try {
                privateKey = await decryptPrivateKey(password, network);
            } catch (err) {
                // If current network fails, try the other network (global password system)
                const otherNetwork = network === Network.Mainnet ? Network.Testnet : Network.Mainnet;
                privateKey = await decryptPrivateKey(password, otherNetwork);
            }

            await chrome.runtime.sendMessage({
                type: "UNLOCK_WALLET",
                mnemonic: privateKey
            })

            const account = createAccountFromSecret(network, privateKey);

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
            <form onSubmit={handleUnlock} className="flex flex-col space-y-6">

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
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 transition text-white p-3 rounded font-semibold disabled:bg-blue-400"
                    disabled={loading || password.length === 0}
                >
                    {loading ? "Unlocking..." : "Unlock Wallet"}
                </button>
            </form>
        </div>
    )
}
