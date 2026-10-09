// Types for the provider the extension injects into web pages as
// window.verifiedX. Copy this file into a site's project to type its calls.
// See "Provider API" in README.md.

export type VerifiedXNetwork = "mainnet" | "testnet"

export interface VerifiedXAccount {
    /** VFX address on the extension's active network. */
    address: string
    /** Uncompressed secp256k1 public key, hex with the 04 prefix. */
    publicKey: string
    network: VerifiedXNetwork
}

export interface VerifiedXSignMessageResult {
    /** The message the site passed in. */
    message: string
    /**
     * The exact text that was signed:
     * "VerifiedX Signed Message:\nOrigin: <site origin>\n\n<message>".
     * Verify the signature against this, not against `message`.
     */
    signedMessage: string
    /** base64(DER signature) + "." + base58(public key), the network's signature format. */
    signature: string
    address: string
    publicKey: string
}

export interface VerifiedXTransactionRequest {
    /** Recipient address, or the target of a feature transaction (e.g. "Token_Base"). */
    to: string
    /** VFX amount as a decimal string ("1.5"); a number is accepted. Required for transfers. */
    amount?: string | number
    /** Transaction type (vfx-web-sdk TxType). Defaults to 0, a VFX transfer. */
    type?: number
    /** Transaction data, as the node expects it for the type. Shown to the user in full. */
    data?: Record<string, unknown> | Array<Record<string, unknown>> | string | null
    /** If given, the request fails with 4901 unless the extension is on this network. */
    network?: VerifiedXNetwork
}

/** A signed transaction in the node's format, ready for /raw/send/. */
export interface VerifiedXSignedTransaction {
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

export interface VerifiedXSignTransactionResult {
    hash: string
    transaction: VerifiedXSignedTransaction
}

export interface VerifiedXSendTransactionResult {
    hash: string
    /**
     * "sent": the node accepted the transaction.
     * "unknown": it was dispatched but the node's reply was lost; it may or may
     * not have been accepted. Look the hash up on chain before sending again.
     */
    status: "sent" | "unknown"
}

export interface VerifiedXRequestMap {
    vfx_connect: { params: undefined; result: VerifiedXAccount[] }
    vfx_getAccounts: { params: undefined; result: VerifiedXAccount[] }
    vfx_disconnect: { params: undefined; result: true }
    vfx_signMessage: { params: { message: string }; result: VerifiedXSignMessageResult }
    vfx_signTransaction: { params: VerifiedXTransactionRequest; result: VerifiedXSignTransactionResult }
    vfx_sendTransaction: { params: VerifiedXTransactionRequest; result: VerifiedXSendTransactionResult }
}

export type VerifiedXMethod = keyof VerifiedXRequestMap

/** Error codes on rejected promises (`error.code`). */
export declare const enum VerifiedXErrorCode {
    UserRejected = 4001,
    Unauthorized = 4100,
    UnsupportedMethod = 4200,
    RequestExpired = 4300,
    WrongNetwork = 4901,
    RequestPending = -32002,
    InvalidParams = -32602,
    Internal = -32603
}

export interface VerifiedXProviderError extends Error {
    code: VerifiedXErrorCode | number
}

export interface VerifiedXProvider {
    readonly isInstalled: true
    isReady(): boolean
    request<M extends VerifiedXMethod>(args: {
        method: M
        params?: VerifiedXRequestMap[M]["params"]
    }): Promise<VerifiedXRequestMap[M]["result"]>
    connect(): Promise<VerifiedXAccount[]>
    getAccounts(): Promise<VerifiedXAccount[]>
    disconnect(): Promise<true>
    signMessage(message: string): Promise<VerifiedXSignMessageResult>
    signTransaction(transaction: VerifiedXTransactionRequest): Promise<VerifiedXSignTransactionResult>
    sendTransaction(transaction: VerifiedXTransactionRequest): Promise<VerifiedXSendTransactionResult>
    /**
     * VerifiedX web wallet only (https://wallet.verifiedx.io for mainnet,
     * https://wallet-testnet.verifiedx.io for testnet). Rejects for any other
     * origin without opening a popup.
     */
    requestKey(): Promise<{ salt: number[]; iv: number[]; cipherText: number[]; address: string; publicKey: string }>
}

declare global {
    interface Window {
        verifiedX?: VerifiedXProvider
    }
    interface WindowEventMap {
        "verifiedX#initialized": Event
    }
}
