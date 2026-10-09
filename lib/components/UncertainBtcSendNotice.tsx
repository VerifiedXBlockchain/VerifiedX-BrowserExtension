import { mempoolTxUrl, type UncertainBtcSend } from "~lib/btcSendCheck"

interface Props {
    send: UncertainBtcSend
}

export default function UncertainBtcSendNotice({ send }: Props) {
    return (
        <div data-testid="uncertain-btc-send" className="bg-amber-900/30 border border-amber-600/50 rounded-lg p-3 text-xs space-y-2">
            <p className="text-sm text-amber-300 font-semibold">Pending: may have been sent</p>
            <p className="text-amber-100">
                Send of {send.amount} BTC to <span className="font-mono break-all">{send.toAddress}</span> was handed to
                the network, but no confirmation came back. It may still go through.
            </p>
            <div className="text-amber-100">
                <div>Transaction ID:</div>
                <a
                    href={mempoolTxUrl(send.network, send.txid)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono break-all underline"
                >
                    {send.txid}
                </a>
            </div>
            <p className="text-amber-200/80">
                Sending BTC is paused until this transaction shows up on the network or can no longer confirm. The
                same transaction is offered to the network again while it is missing; it cannot pay twice. Checking
                every 30 seconds.
            </p>
        </div>
    )
}
