// Builds, signs and sends a VFX transaction in two steps, so the approval
// popup can show the fee before the user decides.
//
// The SDK's sendCoin does every step in one call and only exposes the hash,
// so this follows the same sequence against the same raw-transaction API
// (vfx-web-sdk RawTransactionService): node timestamp, nonce, fee, hash; then
// sign the hash, have the node validate the signature and the transaction,
// and send. Signing uses the SDK, and a lost reply to the send raises the
// SDK's TransactionDispatchError, exactly as sendCoin does.

import { TransactionDispatchError, VfxClient } from "vfx-web-sdk"

import type { SignedVfxTransaction, TransactionRequest } from "~lib/provider/protocol"
import { Network } from "~types/types"

const RAW_API = {
    [Network.Mainnet]: "https://data.verifiedx.io/api/raw",
    [Network.Testnet]: "https://data-testnet.verifiedx.io/api/raw"
}

const REQUEST_TIMEOUT_MS = 30_000

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface PreparedTransaction {
    network: Network
    // Node format, unsigned (Signature empty).
    transaction: SignedVfxTransaction
}

class RawApi {
    constructor(
        private readonly network: Network,
        private readonly fetchFn: FetchFn
    ) {}

    private async post(path: string, body: Record<string, unknown> = {}): Promise<string> {
        const url = `${RAW_API[this.network]}${path}`
        const response = await this.fetchFn(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined
        })
        if (!response.ok) {
            throw new Error(`Request to ${path} failed with status ${response.status}`)
        }
        return response.text()
    }

    private async postJson(path: string, transaction: SignedVfxTransaction): Promise<Record<string, unknown>> {
        return JSON.parse(await this.post(path, { transaction }))
    }

    async timestamp(): Promise<number> {
        return requireNumber(await this.post("/timestamp/"), "timestamp")
    }

    async nonce(address: string): Promise<number> {
        return requireNumber(await this.post(`/nonce/${encodeURIComponent(address)}/`), "nonce")
    }

    async fee(transaction: SignedVfxTransaction): Promise<number> {
        const response = await this.postJson("/fee/", transaction)
        if (response?.Result !== "Success" || response.Fee == null) {
            throw new Error("The network did not return a fee")
        }
        return requireNumber(String(response.Fee), "fee")
    }

    async hash(transaction: SignedVfxTransaction): Promise<string> {
        const response = await this.postJson("/hash/", transaction)
        if (response?.Result !== "Success" || typeof response.Hash !== "string") {
            throw new Error("The network did not return a transaction hash")
        }
        return response.Hash
    }

    async validateSignature(message: string, address: string, signature: string): Promise<boolean> {
        const path = `/validate-signature/${encodeURIComponent(message)}/${encodeURIComponent(address)}/${encodeURIComponent(signature)}/`
        return (await this.post(path)).trim() === "true"
    }

    async verify(transaction: SignedVfxTransaction): Promise<boolean> {
        return (await this.postJson("/verify/", transaction))?.Result === "Success"
    }

    async send(transaction: SignedVfxTransaction): Promise<boolean> {
        return (await this.postJson("/send/", transaction))?.Result === "Success"
    }
}

function requireNumber(text: string, label: string): number {
    const value = Number(text.trim())
    if (!Number.isFinite(value)) {
        throw new Error(`The network returned an invalid ${label}`)
    }
    return value
}

const defaultFetch: FetchFn = (input, init) => fetch(input, init)

// Fetches timestamp, nonce, fee and hash for the requested transaction.
// Nothing is signed.
export async function prepareTransaction(
    network: Network,
    fromAddress: string,
    request: TransactionRequest,
    fetchFn: FetchFn = defaultFetch
): Promise<PreparedTransaction> {
    const api = new RawApi(network, fetchFn)
    const transaction: SignedVfxTransaction = {
        Hash: "",
        ToAddress: request.to,
        FromAddress: fromAddress,
        TransactionType: request.type,
        Amount: Number(request.amount),
        Nonce: 0,
        Fee: 0,
        Timestamp: 0,
        Signature: "",
        Height: 0,
        Data: request.data ?? null,
        UnlockTime: null
    }
    transaction.Timestamp = await api.timestamp()
    transaction.Nonce = await api.nonce(fromAddress)
    transaction.Fee = await api.fee(transaction)
    transaction.Hash = await api.hash(transaction)
    if (!/^[0-9a-fA-F]{64}$/.test(transaction.Hash)) {
        throw new Error("The network returned an invalid transaction hash")
    }
    return { network, transaction }
}

// Signs a prepared transaction and has the node check it. Throws if the
// node rejects the signature or the transaction.
export async function signPreparedTransaction(
    prepared: PreparedTransaction,
    privateKey: string,
    fetchFn: FetchFn = defaultFetch
): Promise<SignedVfxTransaction> {
    const api = new RawApi(prepared.network, fetchFn)
    const client = new VfxClient(prepared.network)
    if (client.addressFromPrivate(privateKey) !== prepared.transaction.FromAddress) {
        throw new Error("The wallet's account changed; try again")
    }
    const transaction = { ...prepared.transaction, Signature: client.getSignature(prepared.transaction.Hash, privateKey) }

    if (!(await api.validateSignature(transaction.Hash, transaction.FromAddress, transaction.Signature))) {
        throw new Error("The network rejected the signature")
    }
    if (!(await api.verify(transaction))) {
        throw new Error("The network rejected the transaction")
    }
    return transaction
}

// Sends a signed transaction. Errors before the request goes out mean it was
// not sent; a lost reply throws TransactionDispatchError carrying the hash.
export async function broadcastTransaction(
    network: Network,
    transaction: SignedVfxTransaction,
    fetchFn: FetchFn = defaultFetch
): Promise<string> {
    const api = new RawApi(network, fetchFn)
    let accepted: boolean
    try {
        accepted = await api.send(transaction)
    } catch (err) {
        throw new TransactionDispatchError(transaction.Hash, err)
    }
    if (!accepted) {
        throw new Error("The network did not accept the transaction")
    }
    return transaction.Hash
}
