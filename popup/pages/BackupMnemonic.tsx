
import { useState } from "react"
import type { Network } from "~types/types"

interface BackupMnemonicProps {
  network: Network
  mnemonic: string
  onConfirm: () => void
}

export default function BackupMnemonic({ network, mnemonic, onConfirm }: BackupMnemonicProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const words = mnemonic.split(" ")

  return (
    <div className="flex flex-col items-center justify-center p-6 space-y-6   text-white">
      <h1 className="text-2xl font-light text-center">Backup Your Recovery Phrase</h1>
      <div className="text-gray-400 text-center">
        Write these 12 words down in order and keep them somewhere safe.
        <div className="text-red-400 font-semibold mt-1">Do not share them with anyone.</div>
      </div>

      <div className="flex space-x-4">
        <button
          onClick={handleCopy}
          className="bg-blue-600 hover:bg-blue-500 transition text-white px-4 py-2 rounded font-semibold"
        >
          {copied ? "Copied!" : "Copy Phrase"}
        </button>

        <button
          onClick={onConfirm}
          className="bg-green-600 hover:bg-green-500 transition text-white px-4 py-2 rounded font-semibold"
        >
          I have backed it up
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 bg-gray-800 p-4 rounded-lg w-full max-w-md">
        {words.map((word, index) => (
          <div
            key={index}
            className="flex items-center space-x-2 bg-gray-700 p-2 rounded text-sm"
          >
            <span className="text-gray-400">{index + 1}.</span>
            <span className="font-mono">{word}</span>
          </div>
        ))}
      </div>


    </div>
  )
}