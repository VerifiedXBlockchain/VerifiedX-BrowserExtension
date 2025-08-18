import { Network, type Transaction } from "~types/types"

interface Props {
    tx: Transaction
    address: string
    network: Network;
}

export default function TransactionCard({ tx, address, network }: Props) {
    const isSent = tx.from_address === address
    const isReceived = tx.to_address === address
    const isPending = (tx as any).isPending || tx.height === -1

    let amountColor = "text-gray-300"
    let amountPrefix = ""

    if (tx.total_amount > 0) {
        if (isSent) {
            amountColor = isPending ? "text-red-300" : "text-red-400"
            amountPrefix = "-"
        } else if (isReceived) {
            amountColor = isPending ? "text-green-300" : "text-green-400"
            amountPrefix = "+"
        }
    }

    const amount = `${amountPrefix}${tx.total_amount.toFixed(2)} VFX`
    const timestamp = new Date(tx.date_crafted).toLocaleString()
    const explorerUrl = `https://spyglass${network == Network.Testnet && '-testnet'}.verifiedx.io/transaction/${tx.hash}` // Update with your explorer

    return (
        <div className={`bg-gray-900 border rounded-xl p-4 shadow-sm space-y-3 ${isPending ? 'border-yellow-500/50 bg-gray-900/50' : 'border-gray-800'}`}>
            <div className="flex justify-between items-center text-sm">
                <span className="text-white font-medium flex items-center gap-2">
                    {tx.type_label == "Address" ? "Domain" : tx.type_label}
                    {isPending && (
                        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                            Pending
                        </span>
                    )}
                </span>
                <span className={`text-sm font-semibold ${amountColor}`}>
                    {amount}
                </span>
            </div>

            <div className="text-xs text-gray-500 leading-snug space-y-1">
                <div><span className="text-gray-400">From:</span> {tx.from_address}</div>
                <div><span className="text-gray-400">To:</span> {tx.to_address}</div>
                <div><span className="text-gray-400">Fee:</span> {tx.total_fee.toFixed(6)}</div>
                <div>{timestamp}</div>
            </div>

            <div className="text-right">
                <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-500 hover:text-blue-400 transition"
                >
                    View on Explorer →
                </a>
            </div>
        </div>
    )
}
