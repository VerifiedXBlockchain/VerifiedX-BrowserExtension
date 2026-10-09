// Shared definitions for the in-page provider (window.verifiedX).
//
// A website asks for something through window.verifiedX.request(). The
// request travels inpage -> content script -> background, the background
// opens an approval popup bound to that one request, and only the result the
// popup produces (an address, a signature, a transaction hash) goes back to
// the page. Key material never leaves the extension.
//
// Everything in this file is pure so it can be unit tested: parameter
// validation runs in the background before a popup opens, and result
// sanitising runs in the background before anything is returned to a page.

import { TxType } from "vfx-web-sdk"

import { formatUnits } from "~lib/amount"
import { validateVfxAddress } from "~lib/utils"
import { Network } from "~types/types"

export const ProviderMethod = {
    Connect: "vfx_connect",
    GetAccounts: "vfx_getAccounts",
    Disconnect: "vfx_disconnect",
    SignMessage: "vfx_signMessage",
    SignTransaction: "vfx_signTransaction",
    SendTransaction: "vfx_sendTransaction"
} as const

export type ProviderMethodName = (typeof ProviderMethod)[keyof typeof ProviderMethod]

// Methods that open an approval popup.
export const APPROVAL_METHODS: ReadonlySet<string> = new Set([
    ProviderMethod.Connect,
    ProviderMethod.SignMessage,
    ProviderMethod.SignTransaction,
    ProviderMethod.SendTransaction
])

// Methods a site may only call after the user has connected it.
export const CONNECTED_METHODS: ReadonlySet<string> = new Set([
    ProviderMethod.SignMessage,
    ProviderMethod.SignTransaction,
    ProviderMethod.SendTransaction
])

export const ProviderErrorCode = {
    UserRejected: 4001,
    Unauthorized: 4100,
    UnsupportedMethod: 4200,
    RequestExpired: 4300,
    WrongNetwork: 4901,
    RequestPending: -32002,
    InvalidParams: -32602,
    Internal: -32603
} as const

export interface ProviderErrorPayload {
    code: number
    message: string
}

export class ProviderError extends Error {
    readonly code: number

    constructor(code: number, message: string) {
        super(message)
        this.code = code
    }

    toPayload(): ProviderErrorPayload {
        return { code: this.code, message: this.message }
    }
}

// One shape rather than a union: the project compiles without
// strictNullChecks, which disables narrowing on a boolean discriminant.
export interface ProviderResponse {
    ok: boolean
    result?: unknown
    error?: ProviderErrorPayload
}

// Bounds on what a page can ask the popup to display.
export const MAX_MESSAGE_LENGTH = 10_000
export const MAX_TX_DATA_BYTES = 16_384
const MAX_TARGET_LENGTH = 128
// VFX amounts carry up to 18 fraction digits on chain.
export const VFX_AMOUNT_DECIMALS = 18

// --- Accounts ---------------------------------------------------------------

export interface VfxAccount {
    address: string
    publicKey: string
    network: Network
}

const ADDRESS_PATTERN = /^[A-Za-z0-9]{34}$/
const PUBLIC_KEY_PATTERN = /^(04)?[0-9a-fA-F]{128}$/
const HASH_PATTERN = /^[0-9a-fA-F]{64}$/
// base64(DER signature) "." base58(public key)
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}\.[1-9A-HJ-NP-Za-km-z]+$/

function isNetwork(value: unknown): value is Network {
    return value === Network.Mainnet || value === Network.Testnet
}

export function sanitizeAccount(value: unknown): VfxAccount {
    const account = value as Partial<VfxAccount> | null
    if (
        !account ||
        typeof account.address !== "string" ||
        !ADDRESS_PATTERN.test(account.address) ||
        typeof account.publicKey !== "string" ||
        !PUBLIC_KEY_PATTERN.test(account.publicKey) ||
        !isNetwork(account.network)
    ) {
        throw new ProviderError(ProviderErrorCode.Internal, "Invalid account")
    }
    return { address: account.address, publicKey: account.publicKey, network: account.network }
}

// --- signMessage ------------------------------------------------------------

export interface SignMessageParams {
    message: string
}

export interface SignMessageResult {
    // The site's message, as given.
    message: string
    // What was actually signed: the message with a VerifiedX prefix and the
    // requesting origin. Verify the signature against this text.
    signedMessage: string
    signature: string
    address: string
    publicKey: string
}

const SIGNED_MESSAGE_PREFIX = "VerifiedX Signed Message:"

// A signed message always starts with this prefix and names the site that
// asked, so it can never be the hex transaction hash a transaction signature
// covers, and a signature obtained by one site does not read as one made for
// another.
export function buildSignedMessage(origin: string, message: string): string {
    return `${SIGNED_MESSAGE_PREFIX}\nOrigin: ${origin}\n\n${message}`
}

export function validateSignMessageParams(params: unknown): SignMessageParams {
    const message = (params as { message?: unknown } | null)?.message
    if (typeof message !== "string" || message.length === 0) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, "message must be a non-empty string")
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, `message is longer than ${MAX_MESSAGE_LENGTH} characters`)
    }
    return { message }
}

// --- signTransaction / sendTransaction --------------------------------------

export interface TransactionRequest {
    to: string
    // Decimal string (preferred) or number of VFX.
    amount: string
    type: number
    data: unknown
    network?: Network
}

const TX_TYPE_NAMES: Record<number, string> = Object.fromEntries(
    Object.entries(TxType)
        .filter(([, value]) => typeof value === "number")
        .map(([name, value]) => [value as number, name])
)

export function txTypeName(type: number): string {
    return TX_TYPE_NAMES[type] ?? `Unknown (${type})`
}

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/
const TARGET_PATTERN = /^[A-Za-z0-9_.:-]+$/

function parseTxAmount(raw: unknown, allowZero: boolean): string {
    let text: string
    if (typeof raw === "number") {
        if (!Number.isFinite(raw) || raw < 0) {
            throw new ProviderError(ProviderErrorCode.InvalidParams, "amount must be a non-negative number")
        }
        text = plainDecimal(raw)
    } else if (typeof raw === "string") {
        text = raw.trim()
    } else {
        throw new ProviderError(ProviderErrorCode.InvalidParams, "amount must be a decimal string")
    }

    const match = AMOUNT_PATTERN.exec(text)
    if (!match) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, "amount must be a decimal like \"1.5\"")
    }
    const fraction = match[2] ?? ""
    if (fraction.replace(/0+$/, "").length > VFX_AMOUNT_DECIMALS) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, `amount has more than ${VFX_AMOUNT_DECIMALS} decimal places`)
    }
    const units =
        BigInt(match[1]) * 10n ** BigInt(VFX_AMOUNT_DECIMALS) +
        BigInt((fraction.slice(0, VFX_AMOUNT_DECIMALS) || "0").padEnd(VFX_AMOUNT_DECIMALS, "0"))
    if (units === 0n && !allowZero) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, "amount must be greater than zero")
    }
    const normalised = formatUnits(units, VFX_AMOUNT_DECIMALS)
    // The node API takes amounts as JSON numbers. Refuse anything a double
    // does not round-trip, so the amount signed is the amount shown.
    if (plainDecimal(Number(normalised)) !== normalised) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, "amount has more precision than the network accepts")
    }
    return normalised
}

// The shortest decimal that round-trips the number, without exponent
// notation: 1e-7 -> "0.0000001".
export function plainDecimal(value: number): string {
    const text = String(value)
    const match = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text)
    if (!match) return text
    const digits = match[1] + (match[2] ?? "")
    const exponent = Number(match[3]) - (match[2]?.length ?? 0)
    if (exponent >= 0) return digits + "0".repeat(exponent)
    const padded = digits.padStart(-exponent + 1, "0")
    const cut = padded.length + exponent
    return `${padded.slice(0, cut)}.${padded.slice(cut)}`.replace(/\.?0+$/, "")
}

export function validateTransactionParams(params: unknown, activeNetwork: Network): TransactionRequest {
    const tx = params as Record<string, unknown> | null
    if (!tx || typeof tx !== "object" || Array.isArray(tx)) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, "Expected a transaction object")
    }

    if (tx.network !== undefined) {
        if (!isNetwork(tx.network)) {
            throw new ProviderError(ProviderErrorCode.InvalidParams, "network must be \"mainnet\" or \"testnet\"")
        }
        if (tx.network !== activeNetwork) {
            throw new ProviderError(
                ProviderErrorCode.WrongNetwork,
                `The wallet is on ${activeNetwork}; switch networks in the extension to continue`
            )
        }
    }

    const type = tx.type === undefined ? TxType.RbxTransfer : tx.type
    if (typeof type !== "number" || !Number.isInteger(type) || !(type in TX_TYPE_NAMES)) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, "type must be a known transaction type")
    }

    const to = tx.to
    if (typeof to !== "string" || to.length === 0 || to.length > MAX_TARGET_LENGTH || !TARGET_PATTERN.test(to)) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, "to must be an address")
    }
    if (type === TxType.RbxTransfer && !validateVfxAddress(to, activeNetwork)) {
        throw new ProviderError(ProviderErrorCode.InvalidParams, `to is not a ${activeNetwork} VFX address`)
    }

    const amount = parseTxAmount(tx.amount ?? (type === TxType.RbxTransfer ? undefined : "0"), type !== TxType.RbxTransfer)

    let data: unknown = null
    if (tx.data !== undefined && tx.data !== null) {
        if (typeof tx.data !== "string" && typeof tx.data !== "object") {
            throw new ProviderError(ProviderErrorCode.InvalidParams, "data must be an object, array or string")
        }
        let serialised: string
        try {
            serialised = JSON.stringify(tx.data)
        } catch {
            throw new ProviderError(ProviderErrorCode.InvalidParams, "data must be JSON")
        }
        if (new TextEncoder().encode(serialised).length > MAX_TX_DATA_BYTES) {
            throw new ProviderError(ProviderErrorCode.InvalidParams, `data is larger than ${MAX_TX_DATA_BYTES} bytes`)
        }
        // A plain JSON copy: no prototypes, functions or getters reach the
        // popup or the node.
        data = JSON.parse(serialised)
    }

    return { to, amount, type, data, network: activeNetwork }
}

// The transaction exactly as the node receives it.
export interface SignedVfxTransaction {
    Hash: string
    ToAddress: string
    FromAddress: string
    TransactionType: number
    Amount: number
    Nonce: number
    Fee: number
    Timestamp: number
    Signature: string
    Height: number
    Data: unknown
    UnlockTime: number | null
}

export interface SignTransactionResult {
    hash: string
    transaction: SignedVfxTransaction
}

export interface SendTransactionResult {
    hash: string
    // "sent": the node accepted it. "unknown": it was dispatched but the
    // node's reply was lost, so it may or may not have been accepted. Look the
    // hash up on chain before sending again.
    status: "sent" | "unknown"
}

// --- Result sanitising ------------------------------------------------------

function requirePattern(value: unknown, pattern: RegExp, label: string): string {
    if (typeof value !== "string" || !pattern.test(value)) {
        throw new ProviderError(ProviderErrorCode.Internal, `Invalid ${label} in result`)
    }
    return value
}

function requireNumber(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ProviderError(ProviderErrorCode.Internal, `Invalid ${label} in result`)
    }
    return value
}

// Rebuilds a popup's result from an explicit field list for the method, so
// nothing the popup might attach by mistake is passed on to the page.
export function sanitizeResult(method: string, raw: unknown): unknown {
    const value = raw as Record<string, unknown> | null
    if (!value || typeof value !== "object") {
        throw new ProviderError(ProviderErrorCode.Internal, "Empty result")
    }

    switch (method) {
        case ProviderMethod.Connect:
            return [sanitizeAccount(value.account)]

        case ProviderMethod.SignMessage: {
            const result: SignMessageResult = {
                message: String(value.message),
                signedMessage: String(value.signedMessage),
                signature: requirePattern(value.signature, SIGNATURE_PATTERN, "signature"),
                address: requirePattern(value.address, ADDRESS_PATTERN, "address"),
                publicKey: requirePattern(value.publicKey, PUBLIC_KEY_PATTERN, "public key")
            }
            return result
        }

        case ProviderMethod.SignTransaction: {
            const tx = value.transaction as Record<string, unknown> | null
            if (!tx || typeof tx !== "object") {
                throw new ProviderError(ProviderErrorCode.Internal, "Missing transaction in result")
            }
            const hash = requirePattern(value.hash, HASH_PATTERN, "hash")
            const transaction: SignedVfxTransaction = {
                Hash: requirePattern(tx.Hash, HASH_PATTERN, "hash"),
                ToAddress: requirePattern(tx.ToAddress, TARGET_PATTERN, "recipient"),
                FromAddress: requirePattern(tx.FromAddress, ADDRESS_PATTERN, "sender"),
                TransactionType: requireNumber(tx.TransactionType, "type"),
                Amount: requireNumber(tx.Amount, "amount"),
                Nonce: requireNumber(tx.Nonce, "nonce"),
                Fee: requireNumber(tx.Fee, "fee"),
                Timestamp: requireNumber(tx.Timestamp, "timestamp"),
                Signature: requirePattern(tx.Signature, SIGNATURE_PATTERN, "signature"),
                Height: 0,
                Data: tx.Data === undefined ? null : JSON.parse(JSON.stringify(tx.Data)),
                UnlockTime: tx.UnlockTime == null ? null : requireNumber(tx.UnlockTime, "unlock time")
            }
            if (transaction.Hash !== hash) {
                throw new ProviderError(ProviderErrorCode.Internal, "Hash mismatch in result")
            }
            const result: SignTransactionResult = { hash, transaction }
            return result
        }

        case ProviderMethod.SendTransaction: {
            if (value.status !== "sent" && value.status !== "unknown") {
                throw new ProviderError(ProviderErrorCode.Internal, "Invalid status in result")
            }
            const result: SendTransactionResult = {
                hash: requirePattern(value.hash, HASH_PATTERN, "hash"),
                status: value.status
            }
            return result
        }

        default:
            throw new ProviderError(ProviderErrorCode.UnsupportedMethod, "Unsupported method")
    }
}

// Last check before a result leaves the background: the serialised result
// must not contain the wallet's private key in any common encoding.
export function assertNoKeyMaterial(result: unknown, privateKeyHex: string | null): void {
    if (!privateKeyHex) return
    const key = privateKeyHex.replace(/^00(?=[0-9a-fA-F]{64}$)/, "").toLowerCase()
    if (key.length < 32) return
    const serialised = JSON.stringify(result ?? null).toLowerCase()
    const base64 = btoa(String.fromCharCode(...(key.match(/../g) ?? []).map((byte) => parseInt(byte, 16)))).toLowerCase()
    if (serialised.includes(key) || serialised.includes(base64)) {
        throw new ProviderError(ProviderErrorCode.Internal, "Refused to return the result")
    }
}

export function errorPayload(err: unknown): ProviderErrorPayload {
    if (err instanceof ProviderError) return err.toPayload()
    return { code: ProviderErrorCode.Internal, message: err instanceof Error ? err.message : "Internal error" }
}
