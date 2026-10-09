import { secp256k1 } from "@noble/curves/secp256k1"
import bs58 from "bs58"
import CryptoJS from "crypto-js"
import { VfxClient } from "vfx-web-sdk"
import { beforeEach, describe, expect, it } from "vitest"

import { ConnectionStore, type KeyValueArea } from "~lib/provider/connections"
import { ProviderHandler, type ApprovalOutcome } from "~lib/provider/handler"
import { buildSignedMessage, ProviderErrorCode, ProviderMethod, type ProviderResponse } from "~lib/provider/protocol"
import { ProviderRequestQueue, REQUEST_TTL_MS } from "~lib/provider/requests"
import { createAccountFromSecret } from "~lib/utils"
import { Network } from "~types/types"

const ORIGIN = "https://app.example"
const OTHER_ORIGIN = "https://other.example"
const client = new VfxClient(Network.Testnet)
const PRIVATE_KEY = client.generatePrivateKey()
const ACCOUNT = createAccountFromSecret(Network.Testnet, PRIVATE_KEY)

function memoryArea(): KeyValueArea {
    const data: Record<string, unknown> = {}
    return {
        get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
        set: async (items) => {
            Object.assign(data, structuredClone(items))
        }
    }
}

// Verifies a VFX signature string ("base64(DER).base58(pubkey)") over a
// message without going through the SDK that produced it.
function verifyVfxSignature(message: string, signature: string, publicKeyHex: string): boolean {
    const [derBase64, pubBase58] = signature.split(".")
    const embedded = Buffer.from(bs58.decode(pubBase58)).toString("hex")
    const expected = publicKeyHex.replace(/^04/, "")
    if (embedded !== expected) return false
    const digest = CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex)
    const sig = secp256k1.Signature.fromDER(Buffer.from(derBase64, "base64").toString("hex"))
    return secp256k1.verify(sig.toCompactRawBytes(), Buffer.from(digest, "hex"), Buffer.from("04" + expected, "hex"))
}

interface Harness {
    handler: ProviderHandler
    queue: ProviderRequestQueue
    connections: ConnectionStore
    opened: string[]
    clock: { now: number }
    lock: () => void
    network: { value: Network }
}

function harness(): Harness {
    const clock = { now: 1_000_000 }
    const queue = new ProviderRequestQueue(() => clock.now)
    const connections = new ConnectionStore(memoryArea())
    const opened: string[] = []
    let key: string | null = PRIVATE_KEY
    const network = { value: Network.Testnet }
    let windowId = 100
    const handler = new ProviderHandler({
        queue,
        connections,
        unlockedKey: () => key,
        activeNetwork: async () => network.value,
        deriveAccount: (net, privateKey) => {
            const account = createAccountFromSecret(net, privateKey)
            return { address: account.address, publicKey: account.public, network: net }
        },
        openApprovalWindow: async (requestId) => {
            opened.push(requestId)
            return windowId++
        }
    })
    return { handler, queue, connections, opened, clock, lock: () => (key = null), network }
}

// Lets the handler reach the point where it waits for the popup.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function startRequest(h: Harness, method: string, params?: unknown, origin = ORIGIN) {
    const response = h.handler.handleRequest({ origin, tabId: 1 }, method, params)
    await tick()
    return { response, requestId: h.opened[h.opened.length - 1] }
}

async function connect(h: Harness, origin = ORIGIN) {
    const { response, requestId } = await startRequest(h, ProviderMethod.Connect, undefined, origin)
    await h.handler.handleApproval(requestId, { outcome: "approved", result: {} })
    return response
}

function signMessageAnswer(origin: string, message: string, overrides: Record<string, unknown> = {}): ApprovalOutcome {
    const signedMessage = buildSignedMessage(origin, message)
    return {
        outcome: "approved",
        result: {
            message,
            signedMessage,
            signature: client.getSignature(signedMessage, PRIVATE_KEY),
            address: ACCOUNT.address,
            publicKey: ACCOUNT.public,
            ...overrides
        }
    }
}

function expectNoKey(response: ProviderResponse) {
    // The SDK returns keys with a "00" prefix; check the bare 32 bytes.
    const bare = PRIVATE_KEY.replace(/^00(?=[0-9a-f]{64}$)/i, "").toLowerCase()
    const text = JSON.stringify(response).toLowerCase()
    expect(bare).toHaveLength(64)
    expect(text).not.toContain(bare)
    expect(text).not.toContain(Buffer.from(bare, "hex").toString("base64").toLowerCase())
}

describe("connect / getAccounts / disconnect", () => {
    let h: Harness
    beforeEach(() => {
        h = harness()
    })

    it("returns no accounts to a site that has not connected, without a popup", async () => {
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.GetAccounts, null)
        expect(response).toEqual({ ok: true, result: [] })
        expect(h.opened).toHaveLength(0)
    })

    it("connects after approval and returns only public account data", async () => {
        const response = await connect(h)
        expect(response).toEqual({
            ok: true,
            result: [{ address: ACCOUNT.address, publicKey: ACCOUNT.public, network: Network.Testnet }]
        })
        expectNoKey(response)
        expect(await h.connections.isConnected(ORIGIN)).toBe(true)
        expect(await h.connections.isConnected(OTHER_ORIGIN)).toBe(false)

        const accounts = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.GetAccounts, null)
        expect(accounts.result).toEqual(response.result)
        // A connected, unlocked site reconnects without another popup
        await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.Connect, null)
        expect(h.opened).toHaveLength(1)
    })

    it("uses the account derived in the background, not one supplied by the popup", async () => {
        const { response, requestId } = await startRequest(h, ProviderMethod.Connect)
        await h.handler.handleApproval(requestId, {
            outcome: "approved",
            result: { account: { address: "xAttackerAddressAAAAAAAAAAAAAAAAAAA", publicKey: "00", network: "testnet" } }
        })
        expect((await response).result).toEqual([{ address: ACCOUNT.address, publicKey: ACCOUNT.public, network: Network.Testnet }])
    })

    it("returns no accounts while locked", async () => {
        await connect(h)
        h.lock()
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.GetAccounts, null)
        expect(response.result).toEqual([])
    })

    it("follows the active network", async () => {
        await connect(h)
        h.network.value = Network.Mainnet
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.GetAccounts, null)
        const [account] = response.result as Array<{ address: string; network: string }>
        expect(account.network).toBe(Network.Mainnet)
        expect(account.address.startsWith("R")).toBe(true)
    })

    it("forgets the site on disconnect", async () => {
        await connect(h)
        await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.Disconnect, null)
        expect(await h.connections.isConnected(ORIGIN)).toBe(false)
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.SignMessage, { message: "x" })
        expect(response.error?.code).toBe(ProviderErrorCode.Unauthorized)
    })

    it("rejects a refused connection with 4001", async () => {
        const { response, requestId } = await startRequest(h, ProviderMethod.Connect)
        await h.handler.handleApproval(requestId, { outcome: "rejected" })
        expect((await response).error?.code).toBe(ProviderErrorCode.UserRejected)
        expect(await h.connections.isConnected(ORIGIN)).toBe(false)
    })
})

describe("approval binding and lifetime", () => {
    let h: Harness
    beforeEach(() => {
        h = harness()
    })

    it("answers only the request the popup was opened for", async () => {
        const a = await startRequest(h, ProviderMethod.Connect, undefined, ORIGIN)
        const b = await startRequest(h, ProviderMethod.Connect, undefined, OTHER_ORIGIN)
        expect(a.requestId).not.toBe(b.requestId)

        await h.handler.handleApproval(b.requestId, { outcome: "approved", result: {} })
        expect(await h.connections.isConnected(OTHER_ORIGIN)).toBe(true)
        expect(await h.connections.isConnected(ORIGIN)).toBe(false)
        expect(h.queue.view(a.requestId)?.origin).toBe(ORIGIN)

        await h.handler.handleApproval(a.requestId, { outcome: "rejected" })
        expect((await a.response).error?.code).toBe(ProviderErrorCode.UserRejected)
        expect((await b.response).ok).toBe(true)
    })

    it("cannot be answered twice or with an unknown id", async () => {
        const { requestId } = await startRequest(h, ProviderMethod.Connect)
        expect(await h.handler.handleApproval(requestId, { outcome: "rejected" })).toBe(true)
        expect(await h.handler.handleApproval(requestId, { outcome: "approved", result: {} })).toBe(false)
        expect(await h.handler.handleApproval("made-up", { outcome: "approved", result: {} })).toBe(false)
        expect(await h.connections.isConnected(ORIGIN)).toBe(false)
    })

    it("allows one pending request per site", async () => {
        await startRequest(h, ProviderMethod.Connect)
        const second = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.Connect, null)
        expect(second.error?.code).toBe(ProviderErrorCode.RequestPending)
        expect(h.opened).toHaveLength(1)
        // Another site is not blocked
        await startRequest(h, ProviderMethod.Connect, undefined, OTHER_ORIGIN)
        expect(h.opened).toHaveLength(2)
    })

    it("rejects when the approval window is closed", async () => {
        const { response } = await startRequest(h, ProviderMethod.Connect)
        h.queue.windowClosed(100)
        expect((await response).error?.code).toBe(ProviderErrorCode.UserRejected)
    })

    it("expires unanswered requests", async () => {
        const { response, requestId } = await startRequest(h, ProviderMethod.Connect)
        h.clock.now += REQUEST_TTL_MS + 1
        h.queue.sweep()
        expect((await response).error?.code).toBe(ProviderErrorCode.RequestExpired)
        expect(await h.handler.handleApproval(requestId, { outcome: "approved", result: {} })).toBe(false)
    })

    it("refuses unknown methods, including key export through request()", async () => {
        for (const method of ["vfx_requestKey", "requestKey", "eth_sign", 5]) {
            const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, method, null)
            expect(response.error?.code).toBe(ProviderErrorCode.UnsupportedMethod)
        }
        expect(h.opened).toHaveLength(0)
    })
})

describe("signMessage", () => {
    let h: Harness
    beforeEach(async () => {
        h = harness()
        await connect(h)
    })

    it("requires a connection", async () => {
        const response = await h.handler.handleRequest({ origin: OTHER_ORIGIN, tabId: 1 }, ProviderMethod.SignMessage, {
            message: "hi"
        })
        expect(response.error?.code).toBe(ProviderErrorCode.Unauthorized)
    })

    it("returns a signature that verifies against the account's public key", async () => {
        const { response, requestId } = await startRequest(h, ProviderMethod.SignMessage, { message: "Log in to app.example" })
        expect(h.queue.view(requestId)?.params).toEqual({ message: "Log in to app.example" })
        await h.handler.handleApproval(requestId, signMessageAnswer(ORIGIN, "Log in to app.example", { privateKey: PRIVATE_KEY }))

        const settled = await response
        expect(settled.ok).toBe(true)
        expectNoKey(settled)
        const result = settled.result as Record<string, string>
        expect(Object.keys(result).sort()).toEqual(["address", "message", "publicKey", "signature", "signedMessage"])
        expect(result.signedMessage).toBe(buildSignedMessage(ORIGIN, "Log in to app.example"))
        expect(verifyVfxSignature(result.signedMessage, result.signature, result.publicKey)).toBe(true)
        expect(verifyVfxSignature("Log in to app.example", result.signature, result.publicKey)).toBe(false)
    })

    it("refuses a signature made for a different origin or message", async () => {
        const first = await startRequest(h, ProviderMethod.SignMessage, { message: "a" })
        await h.handler.handleApproval(first.requestId, signMessageAnswer(OTHER_ORIGIN, "a"))
        expect((await first.response).error?.code).toBe(ProviderErrorCode.Internal)

        const second = await startRequest(h, ProviderMethod.SignMessage, { message: "a" })
        await h.handler.handleApproval(second.requestId, signMessageAnswer(ORIGIN, "b"))
        expect((await second.response).error?.code).toBe(ProviderErrorCode.Internal)
    })

    it("fails if the wallet locked before the answer", async () => {
        const { response, requestId } = await startRequest(h, ProviderMethod.SignMessage, { message: "a" })
        h.lock()
        await h.handler.handleApproval(requestId, signMessageAnswer(ORIGIN, "a"))
        expect((await response).ok).toBe(false)
    })
})

describe("transactions", () => {
    let h: Harness
    const TX = { to: "", amount: "2.5" }
    beforeEach(async () => {
        h = harness()
        TX.to = createAccountFromSecret(Network.Testnet, client.generatePrivateKey()).address
        await connect(h)
    })

    it("validates parameters before opening a popup", async () => {
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.SendTransaction, {
            to: TX.to,
            amount: "-1"
        })
        expect(response.error?.code).toBe(ProviderErrorCode.InvalidParams)
        expect(h.opened).toHaveLength(1) // only the connect popup
    })

    it("returns the hash and status of a send", async () => {
        const { response, requestId } = await startRequest(h, ProviderMethod.SendTransaction, TX)
        await h.handler.handleApproval(requestId, { outcome: "approved", result: { hash: "ab".repeat(32), status: "unknown" } })
        expect((await response).result).toEqual({ hash: "ab".repeat(32), status: "unknown" })
    })

    it("refuses a signed transaction that differs from the request", async () => {
        const { response, requestId } = await startRequest(h, ProviderMethod.SignTransaction, TX)
        const hash = "ab".repeat(32)
        await h.handler.handleApproval(requestId, {
            outcome: "approved",
            result: {
                hash,
                transaction: {
                    Hash: hash,
                    ToAddress: ACCOUNT.address,
                    FromAddress: ACCOUNT.address,
                    TransactionType: 0,
                    Amount: 2.5,
                    Nonce: 1,
                    Fee: 0.00001,
                    Timestamp: 1,
                    Signature: client.getSignature(hash, PRIVATE_KEY),
                    Data: null
                }
            }
        })
        expect((await response).error?.message).toMatch(/does not match/)
    })

    it("passes a failure from the popup to the site", async () => {
        const { response, requestId } = await startRequest(h, ProviderMethod.SendTransaction, TX)
        await h.handler.handleApproval(requestId, { outcome: "failed", message: "The network rejected the transaction" })
        expect((await response).error).toEqual({ code: ProviderErrorCode.Internal, message: "The network rejected the transaction" })
    })
})
