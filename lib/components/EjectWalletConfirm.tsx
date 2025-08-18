import { Network } from "~types/types"

interface EjectWalletConfirmProps {
    network: Network
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
}

export default function EjectWalletConfirm({ network, isOpen, onClose, onConfirm }: EjectWalletConfirmProps) {
    if (!isOpen) return null

    return (
        <div>
            <div>

                <div className="space-y-4">
                    <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4">
                        <div className="flex items-start space-x-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                            </svg>
                            <div>
                                <h3 className="text-red-400 font-semibold text-sm">Warning</h3>
                                <p className="text-red-300 text-sm mt-1">
                                    This will permanently remove all wallet data for the <span className="font-semibold">{network}</span> network from this device.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-gray-300 text-sm">
                            Before proceeding, make sure you have:
                        </p>
                        <ul className="text-gray-400 text-sm space-y-1 ml-4">
                            <li>• Backed up your private key or recovery phrase</li>
                            <li>• Recorded your wallet address</li>
                            <li>• Confirmed you can restore access later</li>
                        </ul>
                    </div>

                    <p className="text-gray-400 text-sm">
                        You will need to set up your wallet again to access this network.
                    </p>

                    <div className="flex space-x-3 pt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white p-3 rounded-lg transition-colors font-semibold"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            className="flex-1 bg-red-600 hover:bg-red-500 text-white p-3 rounded-lg transition-colors font-semibold"
                        >
                            Eject Wallet
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}