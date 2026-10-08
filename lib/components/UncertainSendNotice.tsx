import { explorerTxUrl, uncertainSendExpiresAt, type UncertainSend } from "~lib/dispatchCheck"

interface Props {
    send: UncertainSend
}

export default function UncertainSendNotice({ send }: Props) {
    // Display only: the decision uses node time (see lib/dispatchCheck.ts).
    const expiresAt = new Date(uncertainSendExpiresAt(send.chainTimeBasis ?? send.recordedAt))

    return (
        <div data-testid="uncertain-send" className="bg-amber-900/30 border border-amber-600/50 rounded-lg p-3 text-xs space-y-2">
            <p className="text-sm text-amber-300 font-semibold">Pending: may have been sent</p>
            <p className="text-amber-100">
                {send.label} of {send.amount} VFX to <span className="font-mono break-all">{send.toAddress}</span> reached
                the network, but no confirmation came back. It may still go through.
            </p>
            {send.paymentLink && (
                <div className="text-amber-100">
                    <div>Payment link (keep this):</div>
                    <div className="font-mono break-all">{send.paymentLink.fullUrl || send.paymentLink.shortUrl}</div>
                    <div className="text-amber-200/70">Link ID: {send.paymentLink.linkId}</div>
                </div>
            )}
            <div className="text-amber-100">
                <div>Transaction hash:</div>
                <a
                    href={explorerTxUrl(send.network, send.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono break-all underline"
                >
                    {send.hash}
                </a>
            </div>
            <p className="text-amber-200/80">
                Sending VFX is paused until this transaction shows up on chain, or until about{" "}
                {expiresAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, after which it can no longer
                be included. Checking every few seconds.
            </p>
        </div>
    )
}
