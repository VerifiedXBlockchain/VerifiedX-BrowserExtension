import { Network } from "~types/types"

interface NetworkToggleProps {
    network: Network
    onNetworkChange: (network: Network) => void
}

export default function NetworkToggle({ network, onNetworkChange }: NetworkToggleProps) {
    return (
        <div className="flex items-center space-x-1 cursor-pointer hover:text-white transition-colors">
            <select 
                value={network} 
                onChange={(e) => onNetworkChange(e.target.value as Network)}
                className="bg-transparent text-gray-400 text-sm focus:outline-none appearance-none cursor-pointer hover:text-white transition-colors"
            >
                <option value={Network.Testnet}>Testnet</option>
                <option value={Network.Mainnet}>Mainnet</option>
            </select>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3 text-gray-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
        </div>
    )
}