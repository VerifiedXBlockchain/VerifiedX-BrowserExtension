import { describe, expect, it } from "vitest"

import { checkKeyShareOrigin } from "~lib/keyShareOrigins"
import { Network } from "~types/types"

describe("checkKeyShareOrigin", () => {
    it("allows the web wallet on its own network", () => {
        expect(checkKeyShareOrigin("https://wallet.verifiedx.io", Network.Mainnet)).toEqual({ ok: true, network: Network.Mainnet })
        expect(checkKeyShareOrigin("https://wallet-testnet.verifiedx.io", Network.Testnet)).toEqual({
            ok: true,
            network: Network.Testnet
        })
    })

    it("refuses the web wallet when the extension is on the other network", () => {
        expect(checkKeyShareOrigin("https://wallet.verifiedx.io", Network.Testnet).ok).toBe(false)
        expect(checkKeyShareOrigin("https://wallet-testnet.verifiedx.io", Network.Mainnet).ok).toBe(false)
    })

    it("refuses every other origin, including look-alikes", () => {
        for (const origin of [
            "https://app.example",
            "http://wallet.verifiedx.io",
            "https://wallet.verifiedx.io:8443",
            "https://sub.wallet.verifiedx.io",
            "https://verifiedx.io",
            "https://wallet-devnet.verifiedx.io",
            "https://wallet.verifiedx.io.evil.example",
            "https://rbx-web-wallet.web.app",
            "https://WALLET.verifiedx.io",
            "null",
            "",
            "toString",
            "__proto__"
        ]) {
            for (const network of [Network.Mainnet, Network.Testnet]) {
                expect(checkKeyShareOrigin(origin, network).ok, origin).toBe(false)
            }
        }
    })
})
