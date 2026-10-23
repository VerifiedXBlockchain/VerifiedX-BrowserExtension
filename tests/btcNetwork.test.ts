import { afterEach, describe, expect, it, vi } from "vitest"

import { BTC_NETWORK_LABELS, btcApiBaseUrl, btcTxUrl, createBtcClient } from "~lib/btcNetwork"
import { Network } from "~types/types"

const TXID = "ab".repeat(32)

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("btcApiBaseUrl", () => {
    it("uses the VerifiedX signet on testnet and mempool.space on mainnet", () => {
        expect(btcApiBaseUrl(Network.Testnet)).toBe("https://signet.verifiedx.io/api")
        expect(btcApiBaseUrl(Network.Mainnet)).toBe("https://mempool.space/api")
    })
})

describe("btcTxUrl", () => {
    it("links the signet explorer on testnet and mempool.space on mainnet", () => {
        expect(btcTxUrl(Network.Testnet, TXID)).toBe(`https://signet.verifiedx.io/tx/${TXID}`)
        expect(btcTxUrl(Network.Mainnet, TXID)).toBe(`https://mempool.space/tx/${TXID}`)
    })
})

describe("BTC_NETWORK_LABELS", () => {
    it("names the signet on testnet", () => {
        expect(BTC_NETWORK_LABELS[Network.Testnet]).toBe("VerifiedX Bitcoin Signet")
        expect(BTC_NETWORK_LABELS[Network.Mainnet]).toBe("Bitcoin Mainnet")
    })
})

describe("createBtcClient", () => {
    it.each([
        [Network.Testnet, "https://signet.verifiedx.io/api/v1/fees/recommended"],
        [Network.Mainnet, "https://mempool.space/api/v1/fees/recommended"]
    ])("sends %s requests to its API", async (network, expectedUrl) => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ fastestFee: 1 }), { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)

        await createBtcClient(network).getFeeRates()

        expect(String(fetchMock.mock.calls[0][0])).toBe(expectedUrl)
    })
})
