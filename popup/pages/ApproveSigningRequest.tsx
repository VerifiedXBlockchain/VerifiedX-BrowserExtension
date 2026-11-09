import { useState } from "react"
import { VfxClient } from "vfx-web-sdk"

import RequestSite from "~lib/components/RequestSite"
import type { ProviderRequestView } from "~lib/provider/requests"
import {
    describeFlow,
    describeSigningRequest,
    messageFor,
    type SignRequestParams
} from "~lib/provider/signingRequest"
import type { Account, Network } from "~types/types"

export type Answer =
    | { outcome: "approved"; result: unknown }
    | { outcome: "rejected" }
    | { outcome: "failed"; message: string }

interface ApproveSigningRequestProps {
    request: ProviderRequestView
    network: Network
    account: Account
    finish: (reply: Answer) => Promise<void>
    error: string
}

// vfx_signRequest: one approval covers every step of the flow. Each step is
// shown decoded; the messages signed are rebuilt here from the same fields,
// never taken from the page.
export default function ApproveSigningRequest({ request, network, account, finish, error }: ApproveSigningRequestProps) {
    const [processing, setProcessing] = useState(false)
    const params = request.params as SignRequestParams
    const blocked =
        params.signerAddress !== account.address
            ? `This request is for ${params.signerAddress}, which is not the wallet's ${network} account.`
            : ""

    const handleReject = async () => {
        setProcessing(true)
        await finish({ outcome: "rejected" })
        setProcessing(false)
    }

    const handleApprove = async () => {
        setProcessing(true)
        try {
            const client = new VfxClient(network)
            const signatures = params.items.map((item) => ({ signature: client.getSignature(messageFor(item), account.private) }))
            await finish({ outcome: "approved", result: { signatures } })
        } catch (err) {
            console.error("Signing failed:", err)
            await finish({ outcome: "failed", message: err instanceof Error ? err.message : "Signing failed" })
        }
        setProcessing(false)
    }

    const steps = params.items.map((item) => describeSigningRequest(item.request))

    return (
        <div className="flex flex-col p-6 text-white space-y-4" data-testid="approve-request" data-method={request.method}>
            <h1 className="text-xl font-light text-center" data-testid="flow-title">
                {describeFlow(params.items)}
            </h1>

            <RequestSite origin={request.origin} accountLabel={`Account (${network})`} address={account.address} />

            {steps.length > 1 && (
                <p className="text-sm text-gray-300" data-testid="flow-steps">
                    This action needs {steps.length} signatures. Approving signs all of them.
                </p>
            )}

            {steps.map((step, index) => (
                <div key={index} className="bg-gray-800 rounded-lg p-4 space-y-2 text-sm" data-testid="signing-step">
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                        {steps.length > 1 ? `Step ${index + 1} of ${steps.length}: ` : ""}
                        {step.title}
                    </p>
                    {step.rows.map((row) => (
                        <div key={row.label}>
                            <p className="text-xs text-gray-400">{row.label}</p>
                            <p className={row.mono ? "font-mono break-all text-xs" : "break-words"}>{row.value}</p>
                        </div>
                    ))}
                    {step.data && (
                        <div>
                            <p className="text-xs text-gray-400">Data</p>
                            <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto bg-gray-900 rounded p-2">
                                {step.data}
                            </pre>
                        </div>
                    )}
                </div>
            ))}

            <p className="text-xs text-gray-500">
                The extension checked that each signature is for exactly what is shown here. Approving gives the
                signatures to the site, which sends them to the network.
            </p>

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
                    disabled={processing || !!blocked}
                    data-testid="approve"
                    className="flex-1 bg-blue-600 hover:bg-blue-500 p-3 rounded font-semibold disabled:opacity-50">
                    {processing ? "Working..." : steps.length > 1 ? `Approve all ${steps.length}` : "Approve"}
                </button>
            </div>
        </div>
    )
}
