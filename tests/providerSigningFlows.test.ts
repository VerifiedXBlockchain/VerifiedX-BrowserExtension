// vfx_signRequest and btc_signPsbt through the background handler: what is
// refused before a popup opens, what one approval covers, and what reaches
// the site.

import * as ecc from "@bitcoinerlab/secp256k1"
import * as bitcoin from "bitcoinjs-lib"
import { ECPairFactory } from "ecpair"
import { verifySignature, VfxClient } from "vfx-web-sdk"
import { beforeEach, describe, expect, it } from "vitest"

import { ConnectionStore, type KeyValueArea } from "~lib/provider/connections"
import { ProviderHandler } from "~lib/provider/handler"
import { ProviderErrorCode, ProviderMethod } from "~lib/provider/protocol"
import { btcAccountFromWif, signPsbt, type SignPsbtParams } from "~lib/provider/psbt"
import { ProviderRequestQueue } from "~lib/provider/requests"
import { messageFor, sha256Hex, type SignRequestParams, type SignRequestResult } from "~lib/provider/signingRequest"
import { createAccountFromSecret } from "~lib/utils"
import { Network } from "~types/types"

const ORIGIN = "https://wallet-testnet.verifiedx.io"
const client = new VfxClient(Network.Testnet)
const PRIVATE_KEY = client.generatePrivateKey()
const ACCOUNT = createAccountFromSecret(Network.Testnet, PRIVATE_KEY)
const BTC_WIF = ECPairFactory(ecc).makeRandom({ network: bitcoin.networks.testnet }).toWIF()
const BTC_ACCOUNT = btcAccountFromWif(BTC_WIF, Network.Testnet)
const FLOW = "flow-0001"

function memoryArea(): KeyValueArea {
    const data: Record<string, unknown> = {}
    return {
        get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
        set: async (items) => {
            Object.assign(data, structuredClone(items))
        }
    }
}

function harness(withBtc = true) {
    const queue = new ProviderRequestQueue()
    const connections = new ConnectionStore(memoryArea())
    const opened: string[] = []
    let windowId = 1
    const handler = new ProviderHandler({
        queue,
        connections,
        unlockedKey: () => PRIVATE_KEY,
        extensionVersion: () => "1.2.3",
        activeNetwork: async () => Network.Testnet,
        deriveAccount: (network, privateKey) => {
            const account = createAccountFromSecret(network, privateKey)
            return { address: account.address, publicKey: account.public, network }
        },
        openApprovalWindow: async (requestId) => {
            opened.push(requestId)
            return windowId++
        },
        ...(withBtc && { btcAccount: async () => BTC_ACCOUNT })
    })
    return { handler, queue, opened }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function start(h: ReturnType<typeof harness>, method: string, params?: unknown) {
    const response = h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, method, params)
    await tick()
    return { response, requestId: h.opened[h.opened.length - 1] }
}

async function connect(h: ReturnType<typeof harness>) {
    const { response, requestId } = await start(h, ProviderMethod.Connect)
    await h.handler.handleApproval(requestId, { outcome: "approved", result: {} })
    await response
}

function ceremonyItem(step: "start" | "share", timestamp: number) {
    const sessionId = "session-1"
    const message = `${sessionId}.${ACCOUNT.address}.${timestamp}`
    return {
        digestHex: sha256Hex(message),
        request: { kind: "vbtc-ceremony", flowId: FLOW, message, step, ceremonyId: "ceremony-1", sessionId, ownerAddress: ACCOUNT.address, timestamp }
    }
}

const BATCH = { flowId: FLOW, items: [ceremonyItem("start", 1_762_600_000), ceremonyItem("share", 1_762_600_001)] }

describe("vfx_signRequest", () => {
    let h: ReturnType<typeof harness>
    beforeEach(async () => {
        h = harness()
        await connect(h)
    })

    it("needs a connected site", async () => {
        const fresh = harness()
        const response = await fresh.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.SignRequest, BATCH)
        expect(response.error?.code).toBe(ProviderErrorCode.Unauthorized)
    })

    it("refuses a digest mismatch before any popup opens", async () => {
        const forged = { items: [{ ...ceremonyItem("start", 1), digestHex: "ab".repeat(32) }] }
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.SignRequest, forged)
        expect(response.error?.code).toBe(ProviderErrorCode.InvalidParams)
        expect(response.error?.message).toMatch(/digest does not match/)
        expect(h.opened).toHaveLength(1) // only the connect popup
    })

    it("signs a whole flow with one approval and returns verifiable signatures", async () => {
        const { response, requestId } = await start(h, ProviderMethod.SignRequest, BATCH)
        expect(h.opened).toHaveLength(2) // connect + one for the whole batch

        const view = h.queue.view(requestId)
        const params = view.params as SignRequestParams
        expect(params.items).toHaveLength(2)

        const signatures = params.items.map((item) => ({ signature: client.getSignature(messageFor(item), PRIVATE_KEY) }))
        expect(await h.handler.handleApproval(requestId, { outcome: "approved", result: { signatures } })).toBe(true)

        const result = (await response).result as SignRequestResult
        expect(result.flowId).toBe(FLOW)
        expect(result.signatures.map((signed) => signed.digestHex)).toEqual(BATCH.items.map((item) => item.digestHex))
        for (const [index, signed] of result.signatures.entries()) {
            expect(verifySignature(BATCH.items[index].request.message, signed.signature, ACCOUNT.address)).toBe(true)
        }
        expect(JSON.stringify(result)).not.toContain(PRIVATE_KEY.replace(/^00/, ""))
    })

    it("refuses signatures that do not cover the request", async () => {
        const { response, requestId } = await start(h, ProviderMethod.SignRequest, BATCH)
        const signatures = [{ signature: client.getSignature("other", PRIVATE_KEY) }, { signature: client.getSignature("other", PRIVATE_KEY) }]
        await h.handler.handleApproval(requestId, { outcome: "approved", result: { signatures } })
        expect((await response).error?.message).toMatch(/does not verify/)
    })

    it("leaves the existing methods as they were", async () => {
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.GetAccounts, null)
        expect(response.result).toEqual([{ address: ACCOUNT.address, publicKey: ACCOUNT.public, network: Network.Testnet }])
    })
})

function walletPsbt(): string {
    const network = bitcoin.networks.testnet
    const psbt = new bitcoin.Psbt({ network })
    psbt.addInput({
        hash: "33".repeat(32),
        index: 0,
        witnessUtxo: { script: bitcoin.address.toOutputScript(BTC_ACCOUNT.address, network), value: 20_000 }
    })
    psbt.addOutput({ address: BTC_ACCOUNT.address, value: 19_000 })
    return psbt.toBase64()
}

describe("btc_getAccounts and btc_signPsbt", () => {
    it("returns the Bitcoin account to a connected site only", async () => {
        const h = harness()
        const before = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.BtcGetAccounts, null)
        expect(before.result).toEqual([])
        await connect(h)
        const after = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.BtcGetAccounts, null)
        expect(after.result).toEqual([BTC_ACCOUNT])
    })

    it("returns no Bitcoin account when the wallet has none", async () => {
        const h = harness(false)
        await connect(h)
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.BtcGetAccounts, null)
        expect(response.result).toEqual([])
    })

    it("signs a PSBT after approval and checks it in the background", async () => {
        const h = harness()
        await connect(h)
        const { response, requestId } = await start(h, ProviderMethod.BtcSignPsbt, { psbt: walletPsbt(), finalize: true })
        const params = h.queue.view(requestId).params as SignPsbtParams
        await h.handler.handleApproval(requestId, { outcome: "approved", result: signPsbt(params, BTC_WIF) })
        const result = (await response).result as { txHex: string; txid: string; signedInputs: number[] }
        expect(result.signedInputs).toEqual([0])
        expect(bitcoin.Transaction.fromHex(result.txHex).getId()).toBe(result.txid)
    })

    it("refuses an invalid PSBT before any popup opens", async () => {
        const h = harness()
        await connect(h)
        const response = await h.handler.handleRequest({ origin: ORIGIN, tabId: 1 }, ProviderMethod.BtcSignPsbt, { psbt: "nope" })
        expect(response.error?.code).toBe(ProviderErrorCode.InvalidParams)
        expect(h.opened).toHaveLength(1)
    })
})
