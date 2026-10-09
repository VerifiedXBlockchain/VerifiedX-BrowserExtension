// Resolves a BTC send whose broadcast outcome is unknown.
//
// When the broadcast request goes out but no definite answer comes back, the
// SDK (3.6.0+) throws BtcBroadcastUnknownError carrying the txid and the
// signed transaction. The payment may be on the network. Building a new
// transaction then can pay twice: while the first sits in the mempool, the
// address's UTXO list shows its change output, and a new send spends that.
//
// Re-broadcasting the same signed transaction is always safe: it has one
// txid and can confirm at most once. So until the send is settled, BTC sends
// from the account are blocked and each check does:
//
//   found       (in the mempool or a block)          -> sent
//   conflicted  (an input spent by another tx)       -> not sent: it can never confirm
//   unresolved  (an input spent, spender unknown)    -> keep waiting
//   absent      (not seen, every input unspent)      -> re-broadcast the same hex
//       accepted                                     -> sent
//       refused                                      -> not sent once refusals have
//                                                       lasted REFUSAL_SETTLE_MS
//       no answer                                    -> keep waiting
//
// Any lookup that fails keeps waiting. Nothing is released on a guess.
//
// Why releasing after a settled refusal is safe: release needs the network
// to show the transaction absent with all its inputs unspent, and to refuse
// it when offered again. The next send is built by the SDK from every UTXO
// of the address, which then includes those same inputs. Two transactions
// that spend the same input cannot both confirm, so even if the old
// transaction surfaced later from some other node, at most one of the two
// pays. The window only guards against a slow API view (the transaction
// arriving moments after a check said absent).

import { Network } from "~types/types"

export const REFUSAL_SETTLE_MS = 60 * 60 * 1000

export interface UncertainBtcSend {
    txid: string
    // The exact transaction to re-broadcast. Signed, so it holds no key
    // material beyond what the network sees once it is broadcast.
    signedTxHex: string
    network: Network
    // VFX account the BTC key belongs to; the storage key and send block use it.
    accountAddress: string
    btcAddress: string
    toAddress: string
    amount: number
    // Local time the failure was recorded; display only.
    recordedAt: number
    // Local time of the first re-broadcast refusal while the transaction was
    // absent with unspent inputs. Release waits REFUSAL_SETTLE_MS from here.
    refusedSince?: number
    lastRefusal?: string
}

export type BroadcastCheck =
    | { state: "found"; txid: string; confirmed: boolean }
    | { state: "conflicted"; txid: string; conflictingTxid: string }
    | { state: "absent"; txid: string }
    | { state: "unresolved"; txid: string }

// The two BtcClient methods resolution needs (vfx-web-sdk 3.6.0+).
export interface BtcBroadcaster {
    checkBroadcast(signedTxHex: string): Promise<BroadcastCheck>
    broadcastTransaction(signedTxHex: string): Promise<{ success: boolean; result: string | null; error: string | null }>
}

export type BtcSendResolution =
    | { outcome: "sent" }
    | { outcome: "not-sent"; reason: string }
    | { outcome: "pending"; record: UncertainBtcSend }

/**
 * The txid and signed transaction from a BtcBroadcastUnknownError, or null
 * for any other error. Matched by name and read structurally so it does not
 * depend on the SDK version the extension was built against.
 */
export function unknownBtcBroadcast(err: unknown): { txid: string; signedTxHex: string } | null {
    if (!(err instanceof Error) || err.name !== "BtcBroadcastUnknownError") return null
    const { txid, signedTxHex } = err as Error & { txid?: unknown; signedTxHex?: unknown }
    if (typeof txid !== "string" || !txid || typeof signedTxHex !== "string" || !signedTxHex) return null
    return { txid, signedTxHex }
}

export function mempoolTxUrl(network: Network, txid: string): string {
    return `https://mempool.space/${network === Network.Testnet ? "testnet4/" : ""}tx/${txid}`
}

export async function resolveUncertainBtcSend(
    record: UncertainBtcSend,
    client: BtcBroadcaster,
    now: () => number = Date.now
): Promise<BtcSendResolution> {
    const pending: BtcSendResolution = { outcome: "pending", record }

    let check: BroadcastCheck
    try {
        check = await client.checkBroadcast(record.signedTxHex)
    } catch (err) {
        console.error("BTC send check failed:", err)
        return pending
    }

    switch (check.state) {
        case "found":
            return { outcome: "sent" }
        case "conflicted":
            return { outcome: "not-sent", reason: `its coins were spent by ${check.conflictingTxid}` }
        case "unresolved":
            return pending
    }

    let broadcast: Awaited<ReturnType<BtcBroadcaster["broadcastTransaction"]>>
    try {
        broadcast = await client.broadcastTransaction(record.signedTxHex)
    } catch (err) {
        console.error("BTC re-broadcast got no answer:", err)
        return pending
    }
    if (broadcast.success) {
        return { outcome: "sent" }
    }

    const refusedSince = record.refusedSince ?? now()
    if (now() - refusedSince >= REFUSAL_SETTLE_MS) {
        return { outcome: "not-sent", reason: `the network refused it: ${broadcast.error ?? "no reason given"}` }
    }
    return { outcome: "pending", record: { ...record, refusedSince, lastRefusal: broadcast.error ?? undefined } }
}
