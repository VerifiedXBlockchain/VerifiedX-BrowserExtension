import { describe, expect, it } from "vitest"

import {
    assertNoKeyMaterial,
    buildSignedMessage,
    plainDecimal,
    ProviderErrorCode,
    ProviderMethod,
    sanitizeResult,
    validateSignMessageParams,
    validateTransactionParams
} from "~lib/provider/protocol"
import { Network } from "~types/types"

const TESTNET_ADDRESS = "xMfCxABCDEFGHJKLMNPQRSTUVWXYZabcde"
const MAINNET_ADDRESS = "RMfCxABCDEFGHJKLMNPQRSTUVWXYZabcde"
const PRIVATE_KEY = "1f".repeat(32)
const HASH = "ab".repeat(32)
const PUBLIC_KEY = "04" + "cd".repeat(64)
const SIGNATURE = "MEUCIQ+abc/def==.3yZe7d"

function codeOf(fn: () => unknown): number | undefined {
    try {
        fn()
    } catch (err) {
        return (err as { code?: number }).code
    }
    return undefined
}

describe("validateTransactionParams", () => {
    it("accepts a plain transfer and normalises the amount", () => {
        const tx = validateTransactionParams({ to: TESTNET_ADDRESS, amount: "1.50" }, Network.Testnet)
        expect(tx).toEqual({ to: TESTNET_ADDRESS, amount: "1.5", type: 0, data: null, network: Network.Testnet })
    })

    it("accepts numeric amounts without exponent notation", () => {
        expect(validateTransactionParams({ to: TESTNET_ADDRESS, amount: 1e-7 }, Network.Testnet).amount).toBe("0.0000001")
        expect(validateTransactionParams({ to: TESTNET_ADDRESS, amount: 0.1 }, Network.Testnet).amount).toBe("0.1")
    })

    it("rejects malformed, zero, negative and over-precise amounts", () => {
        for (const amount of ["", "1,5", "1.2.3", "-1", "0", "abc", "1e5", -1, NaN, undefined, null, {}]) {
            expect(codeOf(() => validateTransactionParams({ to: TESTNET_ADDRESS, amount }, Network.Testnet))).toBe(
                ProviderErrorCode.InvalidParams
            )
        }
        expect(
            codeOf(() => validateTransactionParams({ to: TESTNET_ADDRESS, amount: "1.1234567890123456789" }, Network.Testnet))
        ).toBe(ProviderErrorCode.InvalidParams)
        // More digits than a double carries
        expect(
            codeOf(() => validateTransactionParams({ to: TESTNET_ADDRESS, amount: "12345678.123456789012" }, Network.Testnet))
        ).toBe(ProviderErrorCode.InvalidParams)
    })

    it("requires an address on the active network for transfers", () => {
        expect(codeOf(() => validateTransactionParams({ to: MAINNET_ADDRESS, amount: "1" }, Network.Testnet))).toBe(
            ProviderErrorCode.InvalidParams
        )
        expect(codeOf(() => validateTransactionParams({ to: "x<script>", amount: "1" }, Network.Testnet))).toBe(
            ProviderErrorCode.InvalidParams
        )
    })

    it("refuses a request for the other network", () => {
        expect(
            codeOf(() => validateTransactionParams({ to: MAINNET_ADDRESS, amount: "1", network: "mainnet" }, Network.Testnet))
        ).toBe(ProviderErrorCode.WrongNetwork)
    })

    it("only allows known transaction types", () => {
        expect(codeOf(() => validateTransactionParams({ to: TESTNET_ADDRESS, amount: "1", type: 999 }, Network.Testnet))).toBe(
            ProviderErrorCode.InvalidParams
        )
        expect(codeOf(() => validateTransactionParams({ to: TESTNET_ADDRESS, amount: "1", type: "0" }, Network.Testnet))).toBe(
            ProviderErrorCode.InvalidParams
        )
        const tokenTx = validateTransactionParams(
            { to: "Token_Base", type: 15, data: [{ Function: "Transfer()" }] },
            Network.Testnet
        )
        expect(tokenTx).toMatchObject({ to: "Token_Base", amount: "0", type: 15, data: [{ Function: "Transfer()" }] })
    })

    it("copies data as plain JSON and bounds its size", () => {
        const data = { a: 1, toJSON: undefined as unknown }
        const tx = validateTransactionParams({ to: TESTNET_ADDRESS, amount: "1", data }, Network.Testnet)
        expect(tx.data).toEqual({ a: 1 })
        expect(tx.data).not.toBe(data)
        expect(
            codeOf(() => validateTransactionParams({ to: TESTNET_ADDRESS, amount: "1", data: "x".repeat(20_000) }, Network.Testnet))
        ).toBe(ProviderErrorCode.InvalidParams)
        expect(codeOf(() => validateTransactionParams({ to: TESTNET_ADDRESS, amount: "1", data: 5 }, Network.Testnet))).toBe(
            ProviderErrorCode.InvalidParams
        )
    })

    it("does not accept a page-supplied hash, signature or sender", () => {
        const tx = validateTransactionParams(
            { to: TESTNET_ADDRESS, amount: "1", hash: HASH, Hash: HASH, Signature: "x", from: MAINNET_ADDRESS },
            Network.Testnet
        )
        expect(Object.keys(tx).sort()).toEqual(["amount", "data", "network", "to", "type"])
    })
})

describe("signMessage", () => {
    it("prefixes the message with VerifiedX and the origin", () => {
        const signed = buildSignedMessage("https://app.example", "hello")
        expect(signed).toBe("VerifiedX Signed Message:\nOrigin: https://app.example\n\nhello")
        expect(/^[0-9a-f]{64}$/i.test(signed)).toBe(false)
        // A message that is itself a transaction hash is still prefixed
        expect(buildSignedMessage("https://app.example", HASH)).not.toBe(HASH)
    })

    it("validates the message", () => {
        expect(validateSignMessageParams({ message: "hi" })).toEqual({ message: "hi" })
        for (const params of [null, {}, { message: "" }, { message: 5 }, { message: "x".repeat(10_001) }]) {
            expect(codeOf(() => validateSignMessageParams(params))).toBe(ProviderErrorCode.InvalidParams)
        }
    })
})

describe("sanitizeResult", () => {
    it("keeps only the documented fields of a signMessage result", () => {
        const result = sanitizeResult(ProviderMethod.SignMessage, {
            message: "m",
            signedMessage: "s",
            signature: SIGNATURE,
            address: TESTNET_ADDRESS,
            publicKey: PUBLIC_KEY,
            privateKey: PRIVATE_KEY,
            private: PRIVATE_KEY
        })
        expect(Object.keys(result as object).sort()).toEqual(["address", "message", "publicKey", "signature", "signedMessage"])
    })

    it("rejects a signature or hash that is not in the expected format", () => {
        expect(() =>
            sanitizeResult(ProviderMethod.SignMessage, {
                message: "m",
                signedMessage: "s",
                signature: PRIVATE_KEY,
                address: TESTNET_ADDRESS,
                publicKey: PUBLIC_KEY
            })
        ).toThrow()
        expect(() => sanitizeResult(ProviderMethod.SendTransaction, { hash: "nope", status: "sent" })).toThrow()
        expect(() => sanitizeResult(ProviderMethod.SendTransaction, { hash: HASH, status: "maybe" })).toThrow()
    })

    it("rebuilds a signed transaction from its node fields", () => {
        const transaction = {
            Hash: HASH,
            ToAddress: TESTNET_ADDRESS,
            FromAddress: TESTNET_ADDRESS,
            TransactionType: 0,
            Amount: 1,
            Nonce: 3,
            Fee: 0.00001,
            Timestamp: 1_760_000_000,
            Signature: SIGNATURE,
            Height: 9,
            Data: null,
            UnlockTime: null,
            PrivateKey: PRIVATE_KEY
        }
        const result = sanitizeResult(ProviderMethod.SignTransaction, { hash: HASH, transaction, extra: 1 }) as {
            transaction: Record<string, unknown>
        }
        expect(Object.keys(result).sort()).toEqual(["hash", "transaction"])
        expect(result.transaction.PrivateKey).toBeUndefined()
        expect(result.transaction.Height).toBe(0)
        expect(() =>
            sanitizeResult(ProviderMethod.SignTransaction, { hash: "cd".repeat(32), transaction })
        ).toThrow()
    })

    it("refuses methods it does not know", () => {
        expect(codeOf(() => sanitizeResult("vfx_exportKey", {}))).toBe(ProviderErrorCode.UnsupportedMethod)
    })
})

describe("assertNoKeyMaterial", () => {
    it("blocks a result that contains the key as hex or base64", () => {
        expect(() => assertNoKeyMaterial({ a: PRIVATE_KEY.toUpperCase() }, PRIVATE_KEY)).toThrow()
        expect(() => assertNoKeyMaterial({ a: `00${PRIVATE_KEY}` }, `00${PRIVATE_KEY}`)).toThrow()
        const base64 = Buffer.from(PRIVATE_KEY, "hex").toString("base64")
        expect(() => assertNoKeyMaterial([base64], PRIVATE_KEY)).toThrow()
    })

    it("passes results without the key", () => {
        expect(() => assertNoKeyMaterial({ hash: HASH, status: "sent" }, PRIVATE_KEY)).not.toThrow()
    })
})

describe("plainDecimal", () => {
    it("never uses exponent notation", () => {
        expect(plainDecimal(1e-7)).toBe("0.0000001")
        expect(plainDecimal(1.5e-10)).toBe("0.00000000015")
        expect(plainDecimal(1e21)).toBe("1000000000000000000000")
        expect(plainDecimal(12.5)).toBe("12.5")
    })
})
