import { useState } from "react"
import { Network, Currency } from "~types/types"

interface SetupBtcProps {
  network: Network
  onCreateFromVfx: () => void
  onImportPrivateKey: () => void
  onImportWif: () => void
}

function SetupBtc({ network, onCreateFromVfx, onImportPrivateKey, onImportWif }: SetupBtcProps) {
  return (
    <div className="px-6 pb-6">
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold text-white mb-2">Setup Bitcoin Wallet</h2>
        <p className="text-gray-400 text-sm">
          Choose how you'd like to set up your Bitcoin wallet
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={onCreateFromVfx}
          className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
        >
          Create from VFX Wallet
        </button>

        <button
          onClick={onImportPrivateKey}
          className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
        >
          Import Private Key
        </button>

        <button
          onClick={onImportWif}
          className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
        >
          Import WIF
        </button>
      </div>

      <div className="mt-6 text-xs text-gray-500 text-center">
        <p>
          Network: {network === Network.Mainnet ? "Bitcoin Mainnet" : "Bitcoin Testnet4"}
        </p>
      </div>
    </div>
  )
}

export default SetupBtc