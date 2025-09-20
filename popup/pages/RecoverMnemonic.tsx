import { useState } from "react"
import { encryptPrivateKey } from "~lib/secureStorage"
import { validateMnemonic, normalizeMnemonic, mnemonicToAccount } from "~lib/utils"
import type { Network, Account } from "~types/types"
import { VfxClient } from 'vfx-web-sdk'

interface RecoverMnemonicProps {
    network: Network
    password: string
    onSuccess: (account: Account) => void
    onBack: () => void
}

export default function RecoverMnemonic({ network, password, onSuccess, onBack }: RecoverMnemonicProps) {
    const [input, setInput] = useState("")
    const [words, setWords] = useState<string[]>([])
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleInputChange = (value: string) => {
        setInput(value)
        setError("")
        
        // Parse words from input
        const parsedWords = normalizeMnemonic(value)
        setWords(parsedWords)
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault()
        const pastedText = e.clipboardData.getData('text')
        handleInputChange(pastedText)
    }

    const removeWord = (indexToRemove: number) => {
        const newWords = words.filter((_, index) => index !== indexToRemove)
        setWords(newWords)
        setInput(newWords.join(' '))
    }

    const handleRecover = async () => {
        setError("")

        if (!validateMnemonic(words)) {
            setError("Invalid mnemonic. Must be 12 or 24 words.")
            return
        }

        setLoading(true)

        try {
            const mnemonic = words.join(' ')
            
            // Test that we can create an account from this mnemonic
            const account = mnemonicToAccount(network, mnemonic, 0)

            // Derive and store the private key (not the mnemonic)
            const client = new VfxClient(network)
            const privateKey = client.privateKeyFromMneumonic(mnemonic, 0)
            await encryptPrivateKey(privateKey, password, network)

            // Unlock in background memory
            await chrome.runtime.sendMessage({
                type: "UNLOCK_WALLET",
                mnemonic: privateKey
            })

            onSuccess(account)
        } catch (err) {
            console.error(err)
            setError("Failed to recover wallet. Please check your mnemonic.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col p-6 space-y-6 min-w-[320px] text-white">
            <h1 className="text-2xl font-light text-center">Recover Wallet</h1>

            <div className="flex flex-col space-y-4">
                <div>
                    <label className="block text-sm text-gray-400 mb-2">
                        Recovery Phrase
                    </label>
                    <textarea
                        placeholder="Enter your 12 or 24 word recovery phrase..."
                        value={input}
                        autoFocus
                        onChange={(e) => handleInputChange(e.target.value)}
                        onPaste={handlePaste}
                        className="w-full bg-gray-800 border border-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Paste your mnemonic or type each word separated by spaces
                    </p>
                </div>

                {/* Word Tags Display */}
                {words.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-sm text-gray-400">
                            Words ({words.length}/24):
                        </div>
                        <div className="flex flex-wrap gap-2 p-3 bg-gray-800 rounded-lg border border-gray-700 min-h-[60px]">
                            {words.map((word, index) => (
                                <span
                                    key={index}
                                    className="inline-flex items-center bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-full text-sm transition-colors group cursor-pointer"
                                    onClick={() => removeWord(index)}
                                >
                                    <span className="mr-1">{index + 1}.</span>
                                    <span>{word}</span>
                                    <svg 
                                        xmlns="http://www.w3.org/2000/svg" 
                                        fill="none" 
                                        viewBox="0 0 24 24" 
                                        strokeWidth={2} 
                                        stroke="currentColor" 
                                        className="w-3 h-3 ml-1 opacity-60 group-hover:opacity-100"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </span>
                            ))}
                            {words.length === 0 && (
                                <span className="text-gray-500 text-sm italic">
                                    Your mnemonic words will appear here as tags...
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                <div className="flex space-x-3">
                    <button
                        onClick={onBack}
                        className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white p-3 rounded-lg transition-colors font-medium"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleRecover}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-lg transition-colors font-semibold disabled:bg-blue-400"
                        disabled={loading || words.length === 0}
                    >
                        {loading ? "Recovering..." : "Recover Wallet"}
                    </button>
                </div>
            </div>
        </div>
    )
}