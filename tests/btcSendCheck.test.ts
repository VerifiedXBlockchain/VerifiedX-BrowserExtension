import { describe, expect, it, vi } from "vitest"

import {
    REFUSAL_SETTLE_MS,
    mempoolTxUrl,
    resolveUncertainBtcSend,
    unknownBtcBroadcast,
    type BroadcastCheck,
    type BtcBroadcaster,
    type UncertainBtcSend
} from "~lib/btcSendCheck"
import { Network } from "~types/types"

const TXID = "ab".repeat(32)
const HEX = "0200000001deadbeef"
const T0 = Date.parse("2026-10-08T12:00:00Z")

const RECORD: UncertainBtcSend = {
    txid: TXID,
    signedTxHex: HEX,
    network: Network.Testnet,
    accountAddress: "xVfxAccount",
    btcAddress: "tb1qsender",
    toAddress: "tb1qrecipient",
    amount: 0.001,
    recordedAt: T0
}

type BroadcastReply = Awaited<ReturnType<BtcBroadcaster["broadcastTransaction"]>>

function fakeClient(check: BroadcastCheck | Error, broadcast?: BroadcastReply | Error) {
    const client = {
        checkBroadcast: vi.fn(async () => {
            if (check instanceof Error) throw check
            return check
        }),
        broadcastTransaction: vi.fn(async () => {
            if (!broadcast) throw new Error("broadcast not expected")
            if (broadcast instanceof Error) throw broadcast
            return broadcast
        })
    }
    return client
}

const REFUSED: BroadcastReply = { success: false, result: null, error: 'Error: sendrawtransaction RPC error: {"code":-26}' }
const ACCEPTED: BroadcastReply = { success: true, result: TXID, error: null }

describe("unknownBtcBroadcast", () => {
    it("reads txid and signed hex from the SDK error by name", () => {
        const err = Object.assign(new Error("unknown"), { name: "BtcBroadcastUnknownError", txid: TXID, signedTxHex: HEX })
        expect(unknownBtcBroadcast(err)).toEqual({ txid: TXID, signedTxHex: HEX })
    })

    it("ignores other errors and incomplete fields", () => {
        expect(unknownBtcBroadcast(new Error("Insufficient funds"))).toBeNull()
        expect(unknownBtcBroadcast(Object.assign(new Error("x"), { name: "BtcBroadcastUnknownError", txid: TXID }))).toBeNull()
        expect(unknownBtcBroadcast(Object.assign(new Error("x"), { name: "TransactionDispatchError", txid: TXID, signedTxHex: HEX }))).toBeNull()
        expect(unknownBtcBroadcast("BtcBroadcastUnknownError")).toBeNull()
    })
})

describe("resolveUncertainBtcSend", () => {
    it("is sent when the transaction is found, without re-broadcasting", async () => {
        const client = fakeClient({ state: "found", txid: TXID, confirmed: false })
        expect(await resolveUncertainBtcSend(RECORD, client)).toEqual({ outcome: "sent" })
        expect(client.broadcastTransaction).not.toHaveBeenCalled()
    })

    it("is not sent when another transaction spent its inputs", async () => {
        const client = fakeClient({ state: "conflicted", txid: TXID, conflictingTxid: "cd".repeat(32) })
        const result = await resolveUncertainBtcSend(RECORD, client)
        expect(result.outcome).toBe("not-sent")
        expect(client.broadcastTransaction).not.toHaveBeenCalled()
    })

    it("keeps waiting when the spender of an input is unknown", async () => {
        const client = fakeClient({ state: "unresolved", txid: TXID })
        expect(await resolveUncertainBtcSend(RECORD, client)).toEqual({ outcome: "pending", record: RECORD })
        expect(client.broadcastTransaction).not.toHaveBeenCalled()
    })

    it("keeps waiting when the lookup fails", async () => {
        const client = fakeClient(new Error("HTTP 503"))
        expect(await resolveUncertainBtcSend(RECORD, client)).toEqual({ outcome: "pending", record: RECORD })
        expect(client.broadcastTransaction).not.toHaveBeenCalled()
    })

    it("re-broadcasts the same signed transaction when absent, and is sent once accepted", async () => {
        const client = fakeClient({ state: "absent", txid: TXID }, ACCEPTED)
        expect(await resolveUncertainBtcSend(RECORD, client)).toEqual({ outcome: "sent" })
        expect(client.broadcastTransaction).toHaveBeenCalledWith(HEX)
    })

    it("keeps waiting when the re-broadcast gets no answer", async () => {
        const unknown = Object.assign(new Error("timeout"), { name: "BtcBroadcastUnknownError" })
        const client = fakeClient({ state: "absent", txid: TXID }, unknown)
        expect(await resolveUncertainBtcSend(RECORD, client)).toEqual({ outcome: "pending", record: RECORD })
    })

    it("starts the settle window on the first refusal and keeps waiting", async () => {
        const client = fakeClient({ state: "absent", txid: TXID }, REFUSED)
        const result = await resolveUncertainBtcSend(RECORD, client, () => T0 + 1000)
        expect(result).toEqual({
            outcome: "pending",
            record: { ...RECORD, refusedSince: T0 + 1000, lastRefusal: REFUSED.error }
        })
    })

    it("keeps waiting while refusals are younger than the settle window", async () => {
        const record = { ...RECORD, refusedSince: T0 }
        const client = fakeClient({ state: "absent", txid: TXID }, REFUSED)
        const result = await resolveUncertainBtcSend(record, client, () => T0 + REFUSAL_SETTLE_MS - 1)
        expect(result.outcome).toBe("pending")
    })

    it("is not sent once refusals have lasted the settle window with the inputs unspent", async () => {
        const record = { ...RECORD, refusedSince: T0 }
        const client = fakeClient({ state: "absent", txid: TXID }, REFUSED)
        const result = await resolveUncertainBtcSend(record, client, () => T0 + REFUSAL_SETTLE_MS)
        expect(result.outcome).toBe("not-sent")
    })

    it("never releases on time alone: a found transaction after refusals is sent", async () => {
        const record = { ...RECORD, refusedSince: T0 }
        const client = fakeClient({ state: "found", txid: TXID, confirmed: true })
        const result = await resolveUncertainBtcSend(record, client, () => T0 + 10 * REFUSAL_SETTLE_MS)
        expect(result).toEqual({ outcome: "sent" })
    })

    it("never releases on time alone: a failed lookup after the window keeps waiting", async () => {
        const record = { ...RECORD, refusedSince: T0 }
        const client = fakeClient(new Error("offline"))
        const result = await resolveUncertainBtcSend(record, client, () => T0 + 10 * REFUSAL_SETTLE_MS)
        expect(result.outcome).toBe("pending")
    })
})

describe("mempoolTxUrl", () => {
    it("links testnet4 and mainnet", () => {
        expect(mempoolTxUrl(Network.Testnet, TXID)).toBe(`https://mempool.space/testnet4/tx/${TXID}`)
        expect(mempoolTxUrl(Network.Mainnet, TXID)).toBe(`https://mempool.space/tx/${TXID}`)
    })
})
