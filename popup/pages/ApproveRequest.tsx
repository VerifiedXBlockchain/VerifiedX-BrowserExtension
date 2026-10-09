import { useEffect, useState } from "react"
import { TransactionDispatchError, VfxClient } from "vfx-web-sdk"

import { formatUnits } from "~lib/amount"
import type { UncertainSend } from "~lib/dispatchCheck"
import {
    buildSignedMessage,
    plainDecimal,
    ProviderMethod,
    txTypeName,
    VFX_AMOUNT_DECIMALS,
    type SendTransactionResult,
    type SignMessageParams,
    type SignMessageResult,
    type SignTransactionResult,
    type TransactionRequest
} from "~lib/provider/protocol"
import type { ProviderRequestView } from "~lib/provider/requests"
import { addPendingTransaction, getUncertainSend, setUncertainSend } from "~lib/secureStorage"
import { broadcastTransaction, prepareTransaction, signPreparedTransaction, type PreparedTransaction } from "~lib/vfxTransaction"
import type { Account, Network } from "~types/types"

interface ApproveRequestProps {
    // The request this popup window was opened for; it never acts on another.
    requestId: string
    network: Network
    account: Account
}

type Answer =
    | { outcome: "approved"; result: unknown }
    | { outcome: "rejected" }
    | { outcome: "failed"; message: string }

async function answer(requestId: string, reply: Answer): Promise<boolean> {
    const response = await chrome.runtime.sendMessage({ type: "PROVIDER_APPROVAL_RESULT", requestId, ...reply })
    return response?.success === true
}

function hostname(origin: string): string {
    try {
        return new URL(origin).hostname
    } catch {
        return origin
    }
}

function toUnits(decimal: string): bigint {
    const [whole, fraction = ""] = decimal.split(".")
    return BigInt(whole) * 10n ** BigInt(VFX_AMOUNT_DECIMALS) + BigInt(fraction.padEnd(VFX_AMOUNT_DECIMALS, "0") || "0")
}

const TITLES: Record<string, string> = {
    [ProviderMethod.Connect]: "Connect Request",
    [ProviderMethod.SignMessage]: "Signature Request",
    [ProviderMethod.SignTransaction]: "Sign Transaction",
    [ProviderMethod.SendTransaction]: "Send Transaction"
}

export default function ApproveRequest({ requestId, network, account }: ApproveRequestProps) {
    const [request, setRequest] = useState<ProviderRequestView | null>(null)
    const [loading, setLoading] = useState(true)
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState("")
    const [prepared, setPrepared] = useState<PreparedTransaction | null>(null)
    const [blocked, setBlocked] = useState("")

    const isTransaction =
        request?.method === ProviderMethod.SignTransaction || request?.method === ProviderMethod.SendTransaction

    useEffect(() => {
        const load = async () => {
            const response = await chrome.runtime.sendMessage({ type: "PROVIDER_GET_REQUEST", requestId })
            // Defensive: only ever act on the request this window was opened for
            setRequest(response?.request?.id === requestId ? response.request : null)
            setLoading(false)
        }
        load()
    }, [requestId])

    useEffect(() => {
        if (!request || !isTransaction) return
        const tx = request.params as TransactionRequest
        let cancelled = false

        const prepare = async () => {
            if (tx.network && tx.network !== network) {
                setBlocked(`This request is for ${tx.network}, but the wallet is on ${network}.`)
                return
            }
            if (request.method === ProviderMethod.SendTransaction && (await getUncertainSend(network, account.address))) {
                setBlocked("An earlier send from this wallet may still be pending. Open the wallet to check it before sending again.")
                return
            }
            try {
                const result = await prepareTransaction(network, account.address, tx)
                if (!cancelled) setPrepared(result)
            } catch (err) {
                console.error("Failed to prepare transaction:", err)
                if (!cancelled) setBlocked(`Could not prepare the transaction: ${err instanceof Error ? err.message : String(err)}`)
            }
        }
        prepare()
        return () => {
            cancelled = true
        }
    }, [request, isTransaction, network, account.address])

    const finish = async (reply: Answer) => {
        const accepted = await answer(requestId, reply)
        if (!accepted) {
            setError("This request has expired or was already answered.")
            setProcessing(false)
            return
        }
        window.close()
    }

    const handleReject = async () => {
        setProcessing(true)
        await finish({ outcome: "rejected" })
    }

    const handleApprove = async () => {
        if (!request) return
        setProcessing(true)
        setError("")

        try {
            if (request.method === ProviderMethod.Connect) {
                await finish({ outcome: "approved", result: {} })
                return
            }

            if (request.method === ProviderMethod.SignMessage) {
                const { message } = request.params as SignMessageParams
                const signedMessage = buildSignedMessage(request.origin, message)
                const signature = new VfxClient(network).getSignature(signedMessage, account.private)
                const result: SignMessageResult = {
                    message,
                    signedMessage,
                    signature,
                    address: account.address,
                    publicKey: account.public
                }
                await finish({ outcome: "approved", result })
                return
            }

            if (!prepared) return
            const signed = await signPreparedTransaction(prepared, account.private)

            if (request.method === ProviderMethod.SignTransaction) {
                const result: SignTransactionResult = { hash: signed.Hash, transaction: signed }
                await finish({ outcome: "approved", result })
                return
            }

            const tx = request.params as TransactionRequest
            let result: SendTransactionResult
            try {
                const hash = await broadcastTransaction(network, signed)
                await addPendingTransaction(network, account.address, {
                    hash,
                    height: -1,
                    type: tx.type,
                    type_label: txTypeName(tx.type),
                    to_address: tx.to,
                    from_address: account.address,
                    total_amount: Number(tx.amount),
                    total_fee: signed.Fee,
                    data: null,
                    date_crafted: new Date().toISOString(),
                    signature: "",
                    nft: null,
                    unlock_time: null,
                    callback_details: null,
                    recovery_details: null,
                    isPending: true
                })
                result = { hash, status: "sent" }
            } catch (err) {
                if (!(err instanceof TransactionDispatchError)) throw err
                // It may have been accepted: block further sends until the
                // chain settles it, as the wallet's own send does.
                const record: UncertainSend = {
                    hash: err.hash,
                    network,
                    fromAddress: account.address,
                    toAddress: tx.to,
                    amount: Number(tx.amount),
                    label: `Send requested by ${hostname(request.origin)}`,
                    recordedAt: Date.now()
                }
                await setUncertainSend(record)
                result = { hash: err.hash, status: "unknown" }
            }
            await finish({ outcome: "approved", result })
        } catch (err) {
            console.error("Request failed:", err)
            await finish({ outcome: "failed", message: err instanceof Error ? err.message : "Request failed" })
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col p-6 text-white items-center justify-center min-h-56">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        )
    }

    if (!request) {
        return (
            <div className="flex flex-col p-6 text-white">
                <p className="text-center text-gray-400">This request has expired or was already answered.</p>
                <button onClick={() => window.close()} className="mt-4 bg-gray-700 hover:bg-gray-600 p-3 rounded font-semibold">
                    Close
                </button>
            </div>
        )
    }

    const tx = isTransaction ? (request.params as TransactionRequest) : null
    const fee = prepared ? plainDecimal(prepared.transaction.Fee) : null
    const approveDisabled = processing || !!blocked || (isTransaction && !prepared)

    return (
        <div className="flex flex-col p-6 text-white space-y-4" data-testid="approve-request" data-method={request.method}>
            <h1 className="text-xl font-light text-center">{TITLES[request.method] ?? "Request"}</h1>

            <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Requesting site:</p>
                <p className="text-lg font-mono break-all" data-testid="request-origin">
                    {hostname(request.origin)}
                </p>
                <p className="text-xs text-gray-500 mt-1 break-all">{request.origin}</p>
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Account ({network}):</p>
                <p className="text-sm font-mono break-all">{account.address}</p>
            </div>

            {request.method === ProviderMethod.Connect && (
                <p className="text-sm text-gray-300">
                    The site will see this address and its public key. It cannot move funds or sign anything without
                    asking you each time.
                </p>
            )}

            {request.method === ProviderMethod.SignMessage && (
                <div className="bg-gray-800 rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">You are signing this exact text:</p>
                    <pre
                        data-testid="signed-message"
                        className="text-xs font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto bg-gray-900 rounded p-2">
                        {buildSignedMessage(request.origin, (request.params as SignMessageParams).message)}
                    </pre>
                    <p className="text-xs text-gray-500 mt-2">Signing a message does not send a transaction.</p>
                </div>
            )}

            {tx && (
                <div className="bg-gray-800 rounded-lg p-4 space-y-2 text-sm" data-testid="tx-details">
                    <div>
                        <p className="text-xs text-gray-400">Type</p>
                        <p data-testid="tx-type">{txTypeName(tx.type)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400">To</p>
                        <p className="font-mono break-all" data-testid="tx-to">
                            {tx.to}
                        </p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400">Amount</p>
                        <p data-testid="tx-amount">{tx.amount} VFX</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400">Network fee</p>
                        <p data-testid="tx-fee">{fee !== null ? `${fee} VFX` : blocked ? "-" : "Calculating..."}</p>
                    </div>
                    {fee !== null && (
                        <div>
                            <p className="text-xs text-gray-400">Total</p>
                            <p className="font-semibold" data-testid="tx-total">
                                {formatUnits(toUnits(tx.amount) + toUnits(fee), VFX_AMOUNT_DECIMALS)} VFX
                            </p>
                        </div>
                    )}
                    {tx.data !== null && tx.data !== undefined && (
                        <div>
                            <p className="text-xs text-gray-400">Data</p>
                            <pre
                                data-testid="tx-data"
                                className="text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto bg-gray-900 rounded p-2">
                                {typeof tx.data === "string" ? tx.data : JSON.stringify(tx.data, null, 2)}
                            </pre>
                        </div>
                    )}
                    {request.method === ProviderMethod.SendTransaction ? (
                        <p className="text-xs text-gray-500">Approving signs and sends this transaction now.</p>
                    ) : (
                        <p className="text-xs text-gray-500">
                            Approving signs this transaction and gives it to the site, which can send it at any time.
                        </p>
                    )}
                </div>
            )}

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
                    disabled={approveDisabled}
                    data-testid="approve"
                    className="flex-1 bg-blue-600 hover:bg-blue-500 p-3 rounded font-semibold disabled:opacity-50">
                    {processing ? "Working..." : request.method === ProviderMethod.Connect ? "Connect" : "Approve"}
                </button>
            </div>
        </div>
    )
}
