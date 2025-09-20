import { useState, useEffect } from "react"
import { encryptPrivateKey, decryptPrivateKey, hasAnyWallet } from "~lib/secureStorage"
import { Network, type Network as NetworkType } from "~types/types"
import { VfxClient } from 'vfx-web-sdk'

interface Props {
    network: NetworkType
    onCreate: (createdMnemonic: string) => void
    onRecoverMnemonic: (password: string) => void
    onImportPrivateKey: (password: string) => void
}

export default function SetupWallet({ network, onCreate, onRecoverMnemonic, onImportPrivateKey }: Props) {
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [hasExistingWallet, setHasExistingWallet] = useState(false)

    useEffect(() => {
        const checkWalletState = async () => {
            const hasWallet = await hasAnyWallet()
            setHasExistingWallet(hasWallet)
        }
        checkWalletState()
    }, [])

    const handleCreateWallet = async () => {
        setError("")


        if (hasExistingWallet) {
            // For existing users, validate password first
            if (password.length < 8) {
                setError("Password must be at least 8 characters.")
                return
            }

            setLoading(true)
            try {
                // Verify password by attempting to decrypt existing wallet
                const otherNetwork = network === Network.Mainnet ? Network.Testnet : Network.Mainnet;
                try {
                    await decryptPrivateKey(password, network);
                } catch (err) {
                    // Try other network
                    await decryptPrivateKey(password, otherNetwork);
                }

                // Password is correct, generate new mnemonic and derive private key
                const client = new VfxClient(network)
                const newMnemonic = client.generateMnemonic(24)
                const newPrivateKey = client.privateKeyFromMneumonic(newMnemonic, 0)

                // Encrypt and store the private key (not the mnemonic)
                await encryptPrivateKey(newPrivateKey, password, network)

                // Don't overwrite background memory - let network switching handle that
                // Background memory should contain the private key for the currently active network
                
                onCreate(newMnemonic)
                return

            } catch (err) {
                console.error(err)
                setError("Incorrect password. Please try again.")
                setLoading(false)
                return
            }
        }

        // For new users, validate password
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
            const client = new VfxClient(network)
            const mnemonic = client.generateMnemonic(24)
            const privateKey = client.privateKeyFromMneumonic(mnemonic, 0)

            // Step 1: Encrypt and store the private key securely
            await encryptPrivateKey(privateKey, password, network)

            // Step 2: (Optional) Immediately unlock in background memory with private key
            await chrome.runtime.sendMessage({
                type: "UNLOCK_WALLET",
                mnemonic: privateKey
            })

            // Step 3: Notify parent flow (still pass mnemonic for backup screen)
            onCreate(mnemonic)
        } catch (err) {
            console.error(err)
            setError("Something went wrong. Try again.")
        } finally {
            setLoading(false)
        }
    }

    const validatePassword = () => {
        setError("")

        if (password.length < 8) {
            setError("Password must be at least 8 characters.")
            return false
        }

        // Only check password confirmation if creating new wallet (not existing user)
        if (!hasExistingWallet && password !== confirmPassword) {
            setError("Passwords do not match.")
            return false
        }

        return true
    }

    const handleRecoverMnemonic = () => {
        if (validatePassword()) {
            onRecoverMnemonic(password)
        }
    }

    const handleImportPrivateKey = () => {
        if (validatePassword()) {
            onImportPrivateKey(password)
        }
    }

    return (
        <div className="flex flex-col p-6 space-y-6 min-w-[320px] text-white">
            <h1 className="text-2xl font-light text-center">
                Create Wallet
            </h1>

            <div className="flex flex-col space-y-4">
                {!hasExistingWallet && (
                    <>
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
                    </>
                )}
                
                {hasExistingWallet && (
                    <>
                        <div className="text-center text-gray-400 text-sm mb-2">
                            Enter your wallet password to create a new wallet for this network.
                        </div>
                        <input
                            type="password"
                            placeholder="Enter your wallet password"
                            value={password}
                            autoFocus
                            onChange={(e) => setPassword(e.target.value)}
                            className="bg-gray-800 border border-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </>
                )}

                {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                <button
                    onClick={handleCreateWallet}
                    className="bg-blue-600 hover:bg-blue-500 transition text-white p-3 rounded-lg font-semibold disabled:bg-blue-400"
                    disabled={loading}
                >
                    {loading ? "Creating..." : "Create Wallet"}
                </button>

                <div className="flex items-center space-x-4 py-1">
                    <div className="flex-1 h-px bg-gray-600"></div>
                    <span className="text-gray-400 text-sm">or</span>
                    <div className="flex-1 h-px bg-gray-600"></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={handleRecoverMnemonic}
                        className="bg-zinc-700 hover:bg-zinc-600 text-white p-2 rounded-lg transition-colors font-medium text-xs"
                    >
                        Import Mnemonic
                    </button>
                    <button
                        onClick={handleImportPrivateKey}
                        className="bg-zinc-700 hover:bg-zinc-600 text-white p-2 rounded-lg transition-colors font-medium text-xs"
                    >
                        Import Private Key
                    </button>
                </div>
            </div>
        </div>
    )
}
