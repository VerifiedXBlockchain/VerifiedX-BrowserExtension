import { useEffect, useState } from "react"

import { formatUnits } from "~lib/amount"
import { BTC_NETWORK_LABELS } from "~lib/btcNetwork"
import RequestSite from "~lib/components/RequestSite"
import { btcAccountFromWif, signPsbt, summarizePsbt, type PsbtSummary, type SignPsbtParams } from "~lib/provider/psbt"
import type { ProviderRequestView } from "~lib/provider/requests"
import { decryptBtcKeypair } from "~lib/secureStorage"
import type { Network } from "~types/types"
import type { Answer } from "~popup/pages/ApproveSigningRequest"

interface ApprovePsbtProps {
    request: ProviderRequestView
    network: Network
    finish: (reply: Answer) => Promise<void>
    error: string
}

function btc(sats: number): string {
    return `${formatUnits(BigInt(sats), 8)} BTC`
}

function short(text: string): string {
    return text.length > 20 ? `${text.slice(0, 10)}...${text.slice(-8)}` : text
}

// btc_signPsbt: shows every input and output, the fee and the change, and
// signs only this wallet's inputs.
export default function ApprovePsbt({ request, network, finish, error }: ApprovePsbtProps) {
    const params = request.params as SignPsbtParams
    const [wif, setWif] = useState<string | null>(null)
    const [address, setAddress] = useState("")
    const [summary, setSummary] = useState<PsbtSummary | null>(null)
    const [blocked, setBlocked] = useState("")
    const [processing, setProcessing] = useState(false)

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (params.network !== network) {
                setBlocked(`This request is for ${params.network}, but the wallet is on ${network}.`)
                return
            }
            try {
                const { mnemonic } = await chrome.runtime.sendMessage({ type: "GET_MNEMONIC" })
                if (!mnemonic) throw new Error("The wallet is locked")
                const keypair = await decryptBtcKeypair(mnemonic, network)
                const account = btcAccountFromWif(keypair.wif, network)
                const result = summarizePsbt(params, account.publicKey)
                if (cancelled) return
                setWif(keypair.wif)
                setAddress(account.address)
                setSummary(result)
            } catch (err) {
                console.error("Could not read the PSBT:", err)
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : String(err)
                    setBlocked(/No BTC wallet/.test(message) ? "Set up Bitcoin in the wallet first." : message)
                }
            }
        }
        load()
        return () => {
            cancelled = true
        }
    }, [params, network])

    const handleReject = async () => {
        setProcessing(true)
        await finish({ outcome: "rejected" })
        setProcessing(false)
    }

    const handleApprove = async () => {
        if (!wif) return
        setProcessing(true)
        try {
            await finish({ outcome: "approved", result: signPsbt(params, wif) })
        } catch (err) {
            console.error("PSBT signing failed:", err)
            await finish({ outcome: "failed", message: err instanceof Error ? err.message : "Signing failed" })
        }
        setProcessing(false)
    }

    return (
        <div className="flex flex-col p-6 text-white space-y-4" data-testid="approve-request" data-method={request.method}>
            <h1 className="text-xl font-light text-center">Sign Bitcoin Transaction</h1>

            <RequestSite
                origin={request.origin}
                accountLabel={`Bitcoin account (${BTC_NETWORK_LABELS[network]})`}
                address={address || "-"}
            />

            {summary && (
                <>
                    <div className="bg-gray-800 rounded-lg p-4 space-y-2 text-sm" data-testid="psbt-summary">
                        <div>
                            <p className="text-xs text-gray-400">You send</p>
                            <p className="font-semibold" data-testid="psbt-sent">
                                {btc(summary.sentSats)}
                            </p>
                            <p className="text-xs text-gray-500">Outputs to others plus the network fee</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400">Network fee</p>
                            <p data-testid="psbt-fee">
                                {btc(summary.feeSats)} (about {summary.feeRateSatVb} sat/vB)
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400">Change back to you</p>
                            <p data-testid="psbt-change">{btc(summary.changeSats)}</p>
                        </div>
                    </div>

                    <div className="bg-gray-800 rounded-lg p-4 space-y-2 text-sm" data-testid="psbt-outputs">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Outputs ({summary.outputs.length})</p>
                        {summary.outputs.map((output) => (
                            <div key={output.index} className="flex justify-between gap-2">
                                <p className="font-mono text-xs break-all">
                                    {output.address ?? (output.opReturnHex !== undefined ? `OP_RETURN ${short(output.opReturnHex)}` : "Non-standard script")}
                                    {output.mine && <span className="ml-1 text-orange-300">(change)</span>}
                                </p>
                                <p className="text-xs whitespace-nowrap">{btc(output.valueSats)}</p>
                            </div>
                        ))}
                    </div>

                    <div className="bg-gray-800 rounded-lg p-4 space-y-2 text-sm" data-testid="psbt-inputs">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Inputs ({summary.inputs.length})</p>
                        {summary.inputs.map((input) => (
                            <div key={input.index} className="flex justify-between gap-2">
                                <p className="font-mono text-xs break-all">
                                    {short(input.txid)}:{input.vout}
                                    <span className={input.mine ? "ml-1 whitespace-nowrap text-orange-300" : "ml-1 whitespace-nowrap text-gray-500"}>
                                        {summary.signInputs.includes(input.index) ? "(signing)" : input.mine ? "(yours)" : "(not yours)"}
                                    </span>
                                </p>
                                <p className="text-xs whitespace-nowrap">{btc(input.valueSats)}</p>
                            </div>
                        ))}
                    </div>

                    {summary.warnings.map((warning) => (
                        <p key={warning} className="text-sm text-amber-300" data-testid="psbt-warning">
                            {warning}
                        </p>
                    ))}

                    <p className="text-xs text-gray-500">
                        {params.finalize
                            ? "Approving signs this transaction and gives it to the site, which can broadcast it at any time."
                            : "Approving signs this wallet's inputs and gives the PSBT back to the site."}
                    </p>
                </>
            )}

            {!summary && !blocked && <p className="text-sm text-gray-400">Reading the transaction...</p>}
            {blocked && (
                <p className="text-sm text-amber-300" data-testid="request-blocked">
                    {blocked}
                </p>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex space-x-3 pt-2">
                <button
                    onClick={handleReject}
                    disabled={processing}
                    data-testid="reject"
                    className="flex-1 bg-gray-700 hover:bg-gray-600 p-3 rounded font-semibold disabled:opacity-50">
                    Reject
                </button>
                <button
                    onClick={handleApprove}
                    disabled={processing || !!blocked || !summary}
                    data-testid="approve"
                    className="flex-1 bg-orange-600 hover:bg-orange-500 p-3 rounded font-semibold disabled:opacity-50">
                    {processing ? "Working..." : "Approve"}
                </button>
            </div>
        </div>
    )
}
