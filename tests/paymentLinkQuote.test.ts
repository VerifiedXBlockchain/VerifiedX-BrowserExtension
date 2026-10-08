import { describe, expect, it } from "vitest"

import type { CreatePaymentLinkResponse } from "~lib/butterflyApi"
import { verifyPaymentLinkQuote } from "~lib/paymentLinkQuote"
import { Network } from "~types/types"

const ESCROW = "xEscrow000000000000000000000000000"
const BALANCE = 1000n * 100000000n

function reply(overrides: Partial<CreatePaymentLinkResponse> = {}): CreatePaymentLinkResponse {
    return {
        link_id: "abc",
        uuid: "u",
        short_url: "https://example.test/s/abc",
        full_url: "https://example.test/claim/abc",
        status: "pending",
        escrow_address: ESCROW,
        raw_transaction: { to_address: ESCROW, amount: "5.00012345", chain: "vfx", token_symbol: "VFX" },
        amount: "5.00012345",
        claim_amount: "5",
        fee_amount: "0.00012345",
        token_symbol: "VFX",
        chain: "vfx",
        ...overrides
    }
}

const FIVE = 5n * 100000000n

describe("verifyPaymentLinkQuote", () => {
    it("accepts a reply that matches the request and returns exact amounts", () => {
        const quote = verifyPaymentLinkQuote(reply(), FIVE, Network.Testnet, BALANCE)
        expect(quote).toMatchObject({ ok: true, escrowAddress: ESCROW, claim: "5", fee: "0.00012345", total: "5.00012345" })
        expect(quote.totalUnits).toBe(500012345n)
    })

    it("accepts trailing-zero formatting and a zero fee", () => {
        const quote = verifyPaymentLinkQuote(
            reply({ amount: "5.00000000", claim_amount: "5.0", fee_amount: "0", raw_transaction: undefined }),
            FIVE,
            Network.Testnet,
            BALANCE
        )
        expect(quote).toMatchObject({ ok: true, total: "5", fee: "0" })
    })

    it("refuses when the link amount differs from what was entered", () => {
        const quote = verifyPaymentLinkQuote(
            reply({ claim_amount: "50", amount: "50.00012345", raw_transaction: undefined }),
            FIVE,
            Network.Testnet,
            BALANCE
        )
        expect(quote.ok).toBe(false)
        expect(quote.error).toContain("does not match the amount you entered")
    })

    it("refuses a one-unit difference", () => {
        const quote = verifyPaymentLinkQuote(
            reply({ claim_amount: "5.00000001", amount: "5.00012346", raw_transaction: undefined }),
            FIVE,
            Network.Testnet,
            BALANCE
        )
        expect(quote.ok).toBe(false)
    })

    it("refuses a total that is not claim plus fee", () => {
        const quote = verifyPaymentLinkQuote(reply({ amount: "6", raw_transaction: undefined }), FIVE, Network.Testnet, BALANCE)
        expect(quote.ok).toBe(false)
        expect(quote.error).toContain("not the link amount plus the fee")
    })

    it("refuses raw transaction details that disagree with the link", () => {
        const other = reply({ raw_transaction: { to_address: "xOther0000000000000000000000000000", amount: "5.00012345", chain: "vfx", token_symbol: "VFX" } })
        expect(verifyPaymentLinkQuote(other, FIVE, Network.Testnet, BALANCE).ok).toBe(false)
    })

    it("refuses an escrow address for the wrong network or of the wrong shape", () => {
        const mainnetEscrow = "REscrow000000000000000000000000000"
        const wrongNet = reply({ escrow_address: mainnetEscrow, raw_transaction: undefined })
        expect(verifyPaymentLinkQuote(wrongNet, FIVE, Network.Testnet, BALANCE).ok).toBe(false)
        expect(verifyPaymentLinkQuote(reply({ escrow_address: "x123", raw_transaction: undefined }), FIVE, Network.Testnet, BALANCE).ok).toBe(false)
    })

    it("refuses a non-VFX link", () => {
        expect(verifyPaymentLinkQuote(reply({ chain: "base", token_symbol: "USDC" }), FIVE, Network.Testnet, BALANCE).ok).toBe(false)
    })

    it("refuses unreadable amounts", () => {
        for (const bad of ["1E-8", "5,0", "", "abc"]) {
            expect(verifyPaymentLinkQuote(reply({ amount: bad, raw_transaction: undefined }), FIVE, Network.Testnet, BALANCE).ok).toBe(false)
        }
        expect(verifyPaymentLinkQuote(reply({ fee_amount: "1E-8", raw_transaction: undefined }), FIVE, Network.Testnet, BALANCE).ok).toBe(false)
    })

    it("refuses a total above the balance", () => {
        expect(verifyPaymentLinkQuote(reply(), FIVE, Network.Testnet, FIVE).ok).toBe(false)
    })
})
