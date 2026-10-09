import { TransactionDispatchError, VfxClient } from "vfx-web-sdk"
import { describe, expect, it } from "vitest"

import { validateTransactionParams } from "~lib/provider/protocol"
import { createAccountFromSecret } from "~lib/utils"
import { broadcastTransaction, prepareTransaction, signPreparedTransaction } from "~lib/vfxTransaction"
import { Network } from "~types/types"

const client = new VfxClient(Network.Testnet)
const PRIVATE_KEY = client.generatePrivateKey()
const ACCOUNT = createAccountFromSecret(Network.Testnet, PRIVATE_KEY)
const RECIPIENT = createAccountFromSecret(Network.Testnet, client.generatePrivateKey()).address
const HASH = "9f".repeat(32)

type Route = { status: number; text: string } | Error

interface Call {
    url: string
    body: Record<string, unknown> | null
}

function fakeNode(overrides: Record<string, Route> = {}) {
    const calls: Call[] = []
    const routes: Record<string, Route> = {
        "/raw/timestamp/": { status: 200, text: "1760000000" },
        "/raw/nonce/": { status: 200, text: "7" },
        "/raw/fee/": { status: 200, text: JSON.stringify({ Result: "Success", Fee: 0.00002 }) },
        "/raw/hash/": { status: 200, text: JSON.stringify({ Result: "Success", Hash: HASH }) },
        "/raw/validate-signature/": { status: 200, text: "true" },
        "/raw/verify/": { status: 200, text: JSON.stringify({ Result: "Success" }) },
        "/raw/send/": { status: 200, text: JSON.stringify({ Result: "Success" }) },
        ...overrides
    }
    const fn = async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
        const path = Object.keys(routes).find((p) => url.includes(p))
        const route = path ? routes[path] : { status: 404, text: "" }
        if (route instanceof Error) throw route
        return new Response(route.text, { status: route.status })
    }
    return { fn, calls }
}

const request = () => validateTransactionParams({ to: RECIPIENT, amount: "2.5", data: { memo: "x" } }, Network.Testnet)

describe("prepareTransaction", () => {
    it("fills timestamp, nonce, fee and hash from the node without signing", async () => {
        const node = fakeNode()
        const prepared = await prepareTransaction(Network.Testnet, ACCOUNT.address, request(), node.fn)
        expect(prepared.transaction).toMatchObject({
            Hash: HASH,
            ToAddress: RECIPIENT,
            FromAddress: ACCOUNT.address,
            TransactionType: 0,
            Amount: 2.5,
            Nonce: 7,
            Fee: 0.00002,
            Timestamp: 1760000000,
            Signature: "",
            Data: { memo: "x" }
        })
        expect(node.calls.map((c) => new URL(c.url).pathname)).toEqual([
            "/api/raw/timestamp/",
            `/api/raw/nonce/${ACCOUNT.address}/`,
            "/api/raw/fee/",
            "/api/raw/hash/"
        ])
        expect(node.calls[0].url.startsWith("https://data-testnet.verifiedx.io/api")).toBe(true)
        // The fee and the hash are computed for the transaction shown
        expect(node.calls[3].body?.transaction).toMatchObject({ Fee: 0.00002, Nonce: 7, Amount: 2.5 })
    })

    it("fails on a bad node answer", async () => {
        await expect(
            prepareTransaction(Network.Testnet, ACCOUNT.address, request(), fakeNode({ "/raw/fee/": { status: 200, text: "{}" } }).fn)
        ).rejects.toThrow(/fee/)
        await expect(
            prepareTransaction(
                Network.Testnet,
                ACCOUNT.address,
                request(),
                fakeNode({ "/raw/hash/": { status: 200, text: JSON.stringify({ Result: "Success", Hash: "zz" }) } }).fn
            )
        ).rejects.toThrow(/hash/)
    })
})

describe("signPreparedTransaction", () => {
    it("signs the prepared hash with the wallet key and has the node check it", async () => {
        const node = fakeNode()
        const prepared = await prepareTransaction(Network.Testnet, ACCOUNT.address, request(), node.fn)
        const signed = await signPreparedTransaction(prepared, PRIVATE_KEY, node.fn)
        expect(signed.Signature).toBe(client.getSignature(HASH, PRIVATE_KEY))
        expect(node.calls.some((c) => c.url.includes("/raw/send/"))).toBe(false)
        expect(node.calls.find((c) => c.url.includes("/raw/verify/"))?.body?.transaction).toMatchObject({ Signature: signed.Signature })
    })

    it("refuses when the node rejects the signature or the transaction", async () => {
        const prepared = await prepareTransaction(Network.Testnet, ACCOUNT.address, request(), fakeNode().fn)
        await expect(
            signPreparedTransaction(prepared, PRIVATE_KEY, fakeNode({ "/raw/validate-signature/": { status: 200, text: "false" } }).fn)
        ).rejects.toThrow(/signature/)
        await expect(
            signPreparedTransaction(prepared, PRIVATE_KEY, fakeNode({ "/raw/verify/": { status: 200, text: "{}" } }).fn)
        ).rejects.toThrow(/transaction/)
    })

    it("refuses to sign for a different account", async () => {
        const prepared = await prepareTransaction(Network.Testnet, ACCOUNT.address, request(), fakeNode().fn)
        await expect(signPreparedTransaction(prepared, client.generatePrivateKey(), fakeNode().fn)).rejects.toThrow(/account/)
    })
})

describe("broadcastTransaction", () => {
    async function signed() {
        const node = fakeNode()
        return signPreparedTransaction(await prepareTransaction(Network.Testnet, ACCOUNT.address, request(), node.fn), PRIVATE_KEY, node.fn)
    }

    it("returns the hash when the node accepts", async () => {
        expect(await broadcastTransaction(Network.Testnet, await signed(), fakeNode().fn)).toBe(HASH)
    })

    it("reports a lost reply as a dispatch error carrying the hash", async () => {
        for (const route of [new TypeError("Failed to fetch"), { status: 502, text: "" }, { status: 200, text: "<html>" }]) {
            const err = await broadcastTransaction(Network.Testnet, await signed(), fakeNode({ "/raw/send/": route }).fn).catch((e) => e)
            expect(err).toBeInstanceOf(TransactionDispatchError)
            expect(err.hash).toBe(HASH)
        }
    })

    it("reports a definite refusal as a plain error", async () => {
        const err = await broadcastTransaction(
            Network.Testnet,
            await signed(),
            fakeNode({ "/raw/send/": { status: 200, text: JSON.stringify({ Result: "Fail" }) } }).fn
        ).catch((e) => e)
        expect(err).not.toBeInstanceOf(TransactionDispatchError)
        expect(err.message).toMatch(/did not accept/)
    })
})
