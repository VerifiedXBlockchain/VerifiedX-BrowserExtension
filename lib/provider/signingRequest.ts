// vfx_signRequest: structured signing for SDK 9.1 Signer clients.
//
// The SDK hands a Signer the SHA-256 digest of each message it needs signed,
// together with a typed SigningRequest that says what the message is. A site
// forwards both. Before a popup opens, the extension rebuilds the message
// from the request's fields (a transaction from its fields with the SDK's
// port of Core's hash, a ceremony or FROST message from Core's format),
// checks that the digest is SHA-256 of that message, and refuses anything
// that does not match. The popup then shows the decoded request, and only
// what it showed is signed. A digest with no request, or a request of a kind
// the extension cannot rebuild, is refused: there is no blind signing.
//
// Pure, so it can be unit tested.

import CryptoJS from "crypto-js"
import {
    canHashLocally,
    coreTxTypeName,
    transactionHash,
    transactionHashPreimage,
    verifySignature,
    type SigningRequest,
    type SigningTransaction
} from "vfx-web-sdk"

import {
    MAX_TX_DATA_BYTES,
    plainDecimal,
    ProviderError,
    ProviderErrorCode,
    txTypeName
} from "~lib/provider/protocol"
import { validateVfxAddress } from "~lib/utils"
import type { Network } from "~types/types"

// A vault creation signs three messages and a multi-input withdrawal two
// plus one per input (the SDK caps inputs well below this).
export const MAX_SIGNING_BATCH = 32
const MAX_FLOW_ID_LENGTH = 128
const MAX_FIELD_LENGTH = 512
const MAX_MESSAGE_LENGTH = 4096

const HEX_DIGEST_PATTERN = /^[0-9a-fA-F]{64}$/
const ADDRESS_PATTERN = /^[A-Za-z0-9]{34}$/
const ID_PATTERN = /^[A-Za-z0-9_.:-]+$/
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}\.[1-9A-HJ-NP-Za-km-z]+$/

export const SIGNING_REQUEST_KINDS = [
    "transaction",
    "vbtc-ceremony",
    "vbtc-ownership",
    "frost-withdrawal",
    "reserve-recovery"
] as const

export type SupportedSigningRequest = Extract<SigningRequest, { kind: (typeof SIGNING_REQUEST_KINDS)[number] }>

export interface SigningItem {
    digestHex: string
    request: SupportedSigningRequest
}

// Validated vfx_signRequest parameters.
export interface SignRequestParams {
    flowId: string
    // The one VFX address every item signs for.
    signerAddress: string
    items: SigningItem[]
}

export interface SignedItem {
    digestHex: string
    // base64(DER).base58(publicKey), the network's signature format.
    signature: string
    // The DER signature as hex, which is what Signer.signDigest returns.
    der: string
}

export interface SignRequestResult {
    flowId: string
    signatures: SignedItem[]
}

function invalid(message: string): never {
    throw new ProviderError(ProviderErrorCode.InvalidParams, message)
}

function requireString(value: unknown, label: string, pattern?: RegExp, maxLength = MAX_FIELD_LENGTH): string {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
        invalid(`${label} must be a non-empty string`)
    }
    if (pattern && !pattern.test(value)) invalid(`${label} is not valid`)
    return value
}

// Free text such as a token description: any length up to the bound, empty
// allowed.
function requireText(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length > MAX_FIELD_LENGTH) invalid(`${label} must be a string`)
    return value
}

function requireInteger(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        invalid(`${label} must be a non-negative integer`)
    }
    return value
}

function requireAmount(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        invalid(`${label} must be a non-negative number`)
    }
    return value
}

function requireAddress(value: unknown, label: string): string {
    return requireString(value, label, ADDRESS_PATTERN)
}

export function sha256Hex(message: string): string {
    return CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex)
}

// Core's leader-auth message for MPC ceremony and FROST steps
// (VBTCController: "{sessionId}.{ownerAddress}.{timestamp}"). Extra
// withdrawal inputs use the session "{base}:i{k}".
function leaderAuthMessage(sessionId: string, ownerAddress: string, timestamp: number): string {
    return `${sessionId}.${ownerAddress}.${timestamp}`
}

function inputSessionId(sessionId: string, inputIndex: number): string {
    const suffix = `:i${inputIndex}`
    return sessionId.endsWith(suffix) ? sessionId : `${sessionId}${suffix}`
}

function validateTransaction(raw: unknown): SigningTransaction {
    const tx = raw as Record<string, unknown> | null
    if (!tx || typeof tx !== "object" || Array.isArray(tx)) invalid("transaction must be an object")

    const transactionType = requireInteger(tx.TransactionType, "transaction.TransactionType")
    if (!canHashLocally(transactionType)) {
        invalid(`Transaction type ${txTypeName(transactionType)} cannot be checked by the extension, so it will not be signed`)
    }

    let data: unknown = null
    if (tx.Data !== undefined && tx.Data !== null) {
        let serialised: string
        try {
            serialised = JSON.stringify(tx.Data)
        } catch {
            invalid("transaction.Data must be JSON")
        }
        if (new TextEncoder().encode(serialised).length > MAX_TX_DATA_BYTES) {
            invalid(`transaction.Data is larger than ${MAX_TX_DATA_BYTES} bytes`)
        }
        data = JSON.parse(serialised)
    }

    return {
        Hash: requireString(tx.Hash, "transaction.Hash", HEX_DIGEST_PATTERN).toLowerCase(),
        FromAddress: requireAddress(tx.FromAddress, "transaction.FromAddress"),
        ToAddress: requireString(tx.ToAddress, "transaction.ToAddress", ID_PATTERN, 128),
        TransactionType: transactionType,
        Amount: requireAmount(tx.Amount, "transaction.Amount"),
        Fee: requireAmount(tx.Fee, "transaction.Fee"),
        Nonce: requireInteger(tx.Nonce, "transaction.Nonce"),
        Timestamp: requireInteger(tx.Timestamp, "transaction.Timestamp"),
        Data: data,
        UnlockTime: tx.UnlockTime === null || tx.UnlockTime === undefined ? null : requireInteger(tx.UnlockTime, "transaction.UnlockTime")
    }
}

// Rebuilds one request from an explicit field list for its kind (so nothing
// else the page attached reaches the popup), and returns it with the message
// the extension itself computed from those fields.
export function rebuildSigningRequest(raw: unknown): { request: SupportedSigningRequest; message: string; signer: string } {
    const value = raw as Record<string, unknown> | null
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("request must be an object")

    const flowId = requireString(value.flowId, "request.flowId", ID_PATTERN, MAX_FLOW_ID_LENGTH)
    const message = requireString(value.message, "request.message", undefined, MAX_MESSAGE_LENGTH)

    switch (value.kind) {
        case "transaction": {
            const transaction = validateTransaction(value.transaction)
            const hashSource = value.hashSource
            if (hashSource !== "local" && hashSource !== "server" && hashSource !== "prepared") {
                invalid("request.hashSource must be local, server or prepared")
            }
            const preimage = transactionHashPreimage(transaction)
            if (value.hashPreimage !== undefined && value.hashPreimage !== preimage) {
                invalid("The transaction's hash preimage does not match its fields")
            }
            const computed = transactionHash(transaction)
            if (computed !== transaction.Hash) {
                invalid(`The transaction hash does not match its fields (expected ${computed}, got ${transaction.Hash})`)
            }
            const request: SupportedSigningRequest = {
                kind: "transaction",
                flowId,
                message,
                transaction,
                hashSource,
                hashPreimage: preimage
            }
            return { request, message: computed, signer: transaction.FromAddress }
        }

        case "vbtc-ceremony": {
            const step = value.step
            if (step !== "start" && step !== "share") invalid("request.step must be start or share")
            const request: SupportedSigningRequest = {
                kind: "vbtc-ceremony",
                flowId,
                message,
                step,
                ceremonyId: requireString(value.ceremonyId, "request.ceremonyId", ID_PATTERN),
                sessionId: requireString(value.sessionId, "request.sessionId", ID_PATTERN),
                ownerAddress: requireAddress(value.ownerAddress, "request.ownerAddress"),
                timestamp: requireInteger(value.timestamp, "request.timestamp")
            }
            return {
                request,
                message: leaderAuthMessage(request.sessionId, request.ownerAddress, request.timestamp),
                signer: request.ownerAddress
            }
        }

        case "vbtc-ownership": {
            const request: SupportedSigningRequest = {
                kind: "vbtc-ownership",
                flowId,
                message,
                ownerAddress: requireAddress(value.ownerAddress, "request.ownerAddress"),
                name: requireText(value.name, "request.name"),
                description: requireText(value.description, "request.description"),
                ticker: requireText(value.ticker, "request.ticker"),
                ceremonyId: requireString(value.ceremonyId, "request.ceremonyId", ID_PATTERN),
                timestamp: requireInteger(value.timestamp, "request.timestamp"),
                uniqueId: requireString(value.uniqueId, "request.uniqueId", ID_PATTERN)
            }
            // vfx-web-sdk createVbtcToken: the ownership proof Core checks.
            const rebuilt = `${request.ownerAddress}${request.name}${request.description}${request.ticker}${request.ceremonyId}${request.timestamp}${request.uniqueId}`
            return { request, message: rebuilt, signer: request.ownerAddress }
        }

        case "frost-withdrawal": {
            const step = value.step
            if (step !== "start" && step !== "share" && step !== "input") {
                invalid("request.step must be start, share or input")
            }
            const request: SupportedSigningRequest = {
                kind: "frost-withdrawal",
                flowId,
                message,
                step,
                scIdentifier: requireString(value.scIdentifier, "request.scIdentifier", ID_PATTERN),
                withdrawalRequestHash: requireString(value.withdrawalRequestHash, "request.withdrawalRequestHash", ID_PATTERN),
                ownerAddress: requireAddress(value.ownerAddress, "request.ownerAddress"),
                sessionId: requireString(value.sessionId, "request.sessionId", ID_PATTERN),
                timestamp: requireInteger(value.timestamp, "request.timestamp")
            }
            if (step === "input") {
                const inputIndex = requireInteger(value.inputIndex, "request.inputIndex")
                if (inputIndex < 1) invalid("request.inputIndex must be 1 or more for an extra input")
                request.inputIndex = inputIndex
            }
            const session = step === "input" ? inputSessionId(request.sessionId, request.inputIndex) : request.sessionId
            return {
                request,
                message: leaderAuthMessage(session, request.ownerAddress, request.timestamp),
                signer: request.ownerAddress
            }
        }

        case "reserve-recovery": {
            const request: SupportedSigningRequest = {
                kind: "reserve-recovery",
                flowId,
                message,
                reserveAddress: requireAddress(value.reserveAddress, "request.reserveAddress"),
                recoveryAddress: requireAddress(value.recoveryAddress, "request.recoveryAddress"),
                signatureTime: requireInteger(value.signatureTime, "request.signatureTime")
            }
            // The recovery key signs "{signatureTime}{recoveryAddress}".
            return {
                request,
                message: `${request.signatureTime}${request.recoveryAddress}`,
                signer: request.recoveryAddress
            }
        }

        case "message":
            invalid("Plain messages are not signed through vfx_signRequest; use vfx_signMessage, which prefixes the site's origin")

        default:
            invalid(`Unsupported signing request kind: ${String(value.kind)}`)
    }
}

// Accepts { digestHex, request } for one signature, or
// { flowId?, items: [{ digestHex, request }, ...] } for one user action that
// needs several. Every item must share one flowId and sign for one address
// on the active network.
export function validateSignRequestParams(params: unknown, activeNetwork: Network): SignRequestParams {
    const value = params as Record<string, unknown> | null
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected { digestHex, request } or { items }")

    const rawItems: unknown[] = Array.isArray(value.items) ? value.items : value.items === undefined ? [value] : invalid("items must be an array")
    if (rawItems.length === 0) invalid("items must not be empty")
    if (rawItems.length > MAX_SIGNING_BATCH) invalid(`At most ${MAX_SIGNING_BATCH} signatures per request`)

    const items: SigningItem[] = []
    let signerAddress: string | null = null
    for (const [index, rawItem] of rawItems.entries()) {
        const item = rawItem as Record<string, unknown> | null
        if (!item || typeof item !== "object") invalid(`items[${index}] must be an object`)
        if (item.request === undefined || item.request === null) {
            invalid(`items[${index}] has no request; the extension never signs a bare digest`)
        }
        const digestHex = requireString(item.digestHex, `items[${index}].digestHex`, HEX_DIGEST_PATTERN).toLowerCase()
        const { request, message, signer } = rebuildSigningRequest(item.request)

        if (request.message !== message) {
            throw new ProviderError(
                ProviderErrorCode.InvalidParams,
                `items[${index}]: the message does not match the request's fields`
            )
        }
        if (sha256Hex(message) !== digestHex) {
            throw new ProviderError(
                ProviderErrorCode.InvalidParams,
                `items[${index}]: the digest does not match the request; refusing to sign`
            )
        }
        if (signerAddress === null) {
            signerAddress = signer
        } else if (signer !== signerAddress) {
            invalid("Every signature in one request must be for the same address")
        }
        items.push({ digestHex, request })
    }

    const flowId = items[0].request.flowId
    if (items.some((item) => item.request.flowId !== flowId)) invalid("Every item in a batch must share one flowId")
    if (value.flowId !== undefined && value.flowId !== flowId) invalid("flowId does not match the items")

    if (!validateVfxAddress(signerAddress, activeNetwork) || signerAddress.startsWith("xRBX")) {
        throw new ProviderError(
            ProviderErrorCode.WrongNetwork,
            `${signerAddress} is not a ${activeNetwork} account; switch networks in the extension to continue`
        )
    }

    return { flowId, signerAddress, items }
}

// The message to sign for an item, rebuilt from its fields.
export function messageFor(item: SigningItem): string {
    return rebuildSigningRequest(item.request).message
}

// DER hex from a network signature string.
export function derHexFromSignature(signature: string): string {
    return Array.from(atob(signature.split(".")[0]), (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("")
}

// Rebuilds the popup's answer from the request (never from the popup's own
// copy of the digests) and checks each signature verifies for the signer's
// address over the message the extension rebuilt.
export function sanitizeSignRequestResult(params: SignRequestParams, raw: unknown, address: string): SignRequestResult {
    const value = raw as { signatures?: unknown } | null
    const signatures = Array.isArray(value?.signatures) ? value.signatures : null
    if (!signatures || signatures.length !== params.items.length) {
        throw new ProviderError(ProviderErrorCode.Internal, "Wrong number of signatures in result")
    }
    if (params.signerAddress !== address) {
        throw new ProviderError(ProviderErrorCode.Internal, "The result does not match the request")
    }
    return {
        flowId: params.flowId,
        signatures: params.items.map((item, index) => {
            const signature = (signatures[index] as { signature?: unknown } | null)?.signature
            if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
                throw new ProviderError(ProviderErrorCode.Internal, "Invalid signature in result")
            }
            if (!verifySignature(messageFor(item), signature, address)) {
                throw new ProviderError(ProviderErrorCode.Internal, "A signature in the result does not verify")
            }
            return { digestHex: item.digestHex, signature, der: derHexFromSignature(signature) }
        })
    }
}

// --- Display ----------------------------------------------------------------

export interface DisplayRow {
    label: string
    value: string
    mono?: boolean
}

export interface SigningRequestDisplay {
    title: string
    rows: DisplayRow[]
    // Pretty-printed transaction data, when there is any.
    data?: string
}

function formatTime(seconds: number): string {
    const date = new Date(seconds * 1000)
    return Number.isNaN(date.getTime()) ? String(seconds) : `${date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")}`
}

function parseData(data: unknown): unknown {
    if (typeof data !== "string") return data
    try {
        return JSON.parse(data)
    } catch {
        return data
    }
}

// Top-level scalar fields of a transaction's data (the first object of an
// array), e.g. Function, ContractUID, Amount, BTCAddress.
function dataRows(data: unknown): DisplayRow[] {
    const parsed = parseData(data)
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    if (!first || typeof first !== "object") return []
    return Object.entries(first as Record<string, unknown>)
        .filter(([, entry]) => ["string", "number", "boolean"].includes(typeof entry))
        .slice(0, 12)
        .map(([key, entry]) => ({ label: `Data: ${key}`, value: String(entry), mono: typeof entry === "string" && entry.length > 24 }))
}

// The vBTC amount a vBTC transaction moves, which travels in its data (the
// transaction's own Amount is VFX, usually 0).
function vbtcAmount(coreName: string, data: unknown): string | null {
    if (!coreName.startsWith("VBTC_V2_")) return null
    const parsed = parseData(data)
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown> | null
    const amount = first && typeof first === "object" ? first.Amount : undefined
    return typeof amount === "number" || typeof amount === "string" ? `${amount} vBTC` : null
}

const TRANSACTION_TITLES: Record<string, string> = {
    TX: "Send VFX",
    VBTC_V2_CONTRACT_CREATE: "Create a vBTC vault",
    VBTC_V2_TRANSFER: "Transfer vBTC",
    VBTC_V2_WITHDRAWAL_REQUEST: "Request a vBTC withdrawal",
    VBTC_V2_WITHDRAWAL_COMPLETE: "Record a vBTC withdrawal",
    VBTC_V2_WITHDRAWAL_CANCEL: "Cancel a vBTC withdrawal",
    RESERVE: "Reserve (vault) account transaction",
    ADNR: "VFX domain transaction",
    NFT_MINT: "Mint an NFT",
    NFT_TX: "Transfer an NFT",
    NFT_BURN: "Burn an NFT",
    FTKN_MINT: "Mint a token",
    FTKN_TX: "Transfer a token",
    FTKN_BURN: "Burn a token"
}

export function describeSigningRequest(request: SupportedSigningRequest): SigningRequestDisplay {
    switch (request.kind) {
        case "transaction": {
            const tx = request.transaction
            const coreName = coreTxTypeName(tx.TransactionType)
            const rows: DisplayRow[] = [
                { label: "Type", value: `${txTypeName(tx.TransactionType)} (${tx.TransactionType})` },
                { label: "From", value: tx.FromAddress, mono: true },
                { label: "To", value: tx.ToAddress, mono: true },
                ...(vbtcAmount(coreName, tx.Data) ? [{ label: "vBTC amount", value: vbtcAmount(coreName, tx.Data) }] : []),
                { label: "Amount", value: `${plainDecimal(tx.Amount)} VFX` },
                { label: "Network fee", value: `${plainDecimal(tx.Fee)} VFX` },
                { label: "Nonce", value: String(tx.Nonce) },
                { label: "Created", value: formatTime(tx.Timestamp) }
            ]
            if (tx.UnlockTime !== null) rows.push({ label: "Unlocks", value: formatTime(tx.UnlockTime) })
            rows.push(...dataRows(tx.Data))
            rows.push({ label: "Hash", value: tx.Hash, mono: true })
            return {
                title: TRANSACTION_TITLES[coreName] ?? `Sign a ${txTypeName(tx.TransactionType)} transaction`,
                rows,
                ...(tx.Data !== null && { data: JSON.stringify(parseData(tx.Data), null, 2) })
            }
        }
        case "vbtc-ceremony":
            return {
                title: `vBTC vault key ceremony (${request.step === "start" ? "start" : "share distribution"})`,
                rows: [
                    { label: "Vault owner", value: request.ownerAddress, mono: true },
                    { label: "Ceremony", value: request.ceremonyId, mono: true },
                    { label: "Session", value: request.sessionId, mono: true },
                    { label: "Time", value: formatTime(request.timestamp) }
                ]
            }
        case "vbtc-ownership":
            return {
                title: "Claim ownership of a new vBTC vault",
                rows: [
                    { label: "Owner", value: request.ownerAddress, mono: true },
                    { label: "Name", value: request.name },
                    { label: "Ticker", value: request.ticker },
                    { label: "Description", value: request.description || "-" },
                    { label: "Ceremony", value: request.ceremonyId, mono: true },
                    { label: "Time", value: formatTime(request.timestamp) }
                ]
            }
        case "frost-withdrawal": {
            const stepLabel =
                request.step === "start" ? "start" : request.step === "share" ? "share distribution" : `input ${request.inputIndex}`
            return {
                title: `vBTC withdrawal signing (${stepLabel})`,
                rows: [
                    { label: "Vault", value: request.scIdentifier, mono: true },
                    { label: "Owner", value: request.ownerAddress, mono: true },
                    { label: "Withdrawal request", value: request.withdrawalRequestHash, mono: true },
                    { label: "Session", value: request.sessionId, mono: true },
                    { label: "Time", value: formatTime(request.timestamp) }
                ]
            }
        }
        case "reserve-recovery":
            return {
                title: "Recover a reserve (vault) account",
                rows: [
                    { label: "Reserve account", value: request.reserveAddress, mono: true },
                    { label: "Funds go to", value: request.recoveryAddress, mono: true },
                    { label: "Signed at", value: formatTime(request.signatureTime) }
                ]
            }
    }
}

// One headline for the whole flow, from what its steps do.
export function describeFlow(items: SigningItem[]): string {
    const kinds = new Set(items.map((item) => item.request.kind))
    if (kinds.has("vbtc-ceremony") || kinds.has("vbtc-ownership")) return "Create a vBTC vault"
    if (kinds.has("frost-withdrawal")) return "Complete a vBTC withdrawal"
    if (kinds.has("reserve-recovery")) return "Recover a reserve account"
    if (items.length === 1) return describeSigningRequest(items[0].request).title
    return `Sign ${items.length} transactions`
}
