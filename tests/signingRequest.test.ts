import { transactionHash, transactionHashPreimage, TxType, VfxClient, type SigningTransaction } from "vfx-web-sdk"
import { describe, expect, it } from "vitest"

import { ProviderErrorCode } from "~lib/provider/protocol"
import {
    derHexFromSignature,
    describeFlow,
    describeSigningRequest,
    MAX_SIGNING_BATCH,
    messageFor,
    sanitizeSignRequestResult,
    sha256Hex,
    validateSignRequestParams
} from "~lib/provider/signingRequest"
import { createAccountFromSecret } from "~lib/utils"

import NFT_VECTORS from "./fixtures/nftSigningVectors.json"
import { Network } from "~types/types"

const client = new VfxClient(Network.Testnet)
const PRIVATE_KEY = client.generatePrivateKey()
const ACCOUNT = createAccountFromSecret(Network.Testnet, PRIVATE_KEY)
const OTHER = createAccountFromSecret(Network.Testnet, client.generatePrivateKey())
const MAINNET_ACCOUNT = createAccountFromSecret(Network.Mainnet, PRIVATE_KEY)
const FLOW = "a1b2c3d4e5f6a1b2c3d4e5f6"

function errorOf(fn: () => unknown): { code?: number; message?: string } {
    try {
        fn()
    } catch (err) {
        return err as { code?: number; message?: string }
    }
    throw new Error("expected a throw")
}

function transaction(overrides: Partial<SigningTransaction> = {}): SigningTransaction {
    const tx: SigningTransaction = {
        Hash: "",
        FromAddress: ACCOUNT.address,
        ToAddress: OTHER.address,
        TransactionType: TxType.RbxTransfer,
        Amount: 1.5,
        Fee: 0.00002,
        Nonce: 7,
        Timestamp: 1_762_600_000,
        Data: null,
        UnlockTime: null,
        ...overrides
    }
    tx.Hash = overrides.Hash ?? transactionHash(tx)
    return tx
}

function txItem(tx: SigningTransaction = transaction(), extra: Record<string, unknown> = {}) {
    const request = { kind: "transaction", flowId: FLOW, message: tx.Hash, transaction: tx, hashSource: "local", ...extra }
    return { digestHex: sha256Hex(tx.Hash), request }
}

function ceremonyItem(step: "start" | "share", timestamp: number, owner = ACCOUNT.address) {
    const sessionId = "6f1c1d1e-0000-4000-8000-000000000001"
    const message = `${sessionId}.${owner}.${timestamp}`
    return {
        digestHex: sha256Hex(message),
        request: { kind: "vbtc-ceremony", flowId: FLOW, message, step, ceremonyId: "vbtc-abc123", sessionId, ownerAddress: owner, timestamp }
    }
}

function frostItem(step: "start" | "share" | "input", timestamp: number, inputIndex?: number, sessionId = "sess-1") {
    const session = step === "input" ? `sess-1:i${inputIndex}` : "sess-1"
    const message = `${session}.${ACCOUNT.address}.${timestamp}`
    return {
        digestHex: sha256Hex(message),
        request: {
            kind: "frost-withdrawal",
            flowId: FLOW,
            message,
            step,
            scIdentifier: "vault-uid-1",
            withdrawalRequestHash: "ab".repeat(32),
            ownerAddress: ACCOUNT.address,
            sessionId,
            timestamp,
            ...(inputIndex !== undefined && { inputIndex })
        }
    }
}

function ownershipItem() {
    const fields = {
        ownerAddress: ACCOUNT.address,
        name: "My Vault",
        description: "Savings",
        ticker: "VBTC",
        ceremonyId: "vbtc-abc123",
        timestamp: 1_762_600_100,
        uniqueId: "ABCDEFGH12345678"
    }
    const message = `${fields.ownerAddress}${fields.name}${fields.description}${fields.ticker}${fields.ceremonyId}${fields.timestamp}${fields.uniqueId}`
    return { digestHex: sha256Hex(message), request: { kind: "vbtc-ownership", flowId: FLOW, message, ...fields } }
}

function recoveryItem() {
    const message = `1762600200${ACCOUNT.address}`
    return {
        digestHex: sha256Hex(message),
        request: {
            kind: "reserve-recovery",
            flowId: FLOW,
            message,
            reserveAddress: "xRBXabcdefghijkmnopqrstuvwxyzABCDE",
            recoveryAddress: ACCOUNT.address,
            signatureTime: 1_762_600_200
        }
    }
}

describe("digest checks", () => {
    it("accepts a transaction whose hash and digest match its fields", () => {
        const params = validateSignRequestParams(txItem(), Network.Testnet)
        expect(params.items).toHaveLength(1)
        expect(params.signerAddress).toBe(ACCOUNT.address)
        expect(params.flowId).toBe(FLOW)
    })

    it("refuses a digest that is not SHA-256 of the request's message", () => {
        const item = { ...txItem(), digestHex: sha256Hex("something else") }
        const err = errorOf(() => validateSignRequestParams(item, Network.Testnet))
        expect(err.code).toBe(ProviderErrorCode.InvalidParams)
        expect(err.message).toMatch(/digest does not match/)
    })

    it("refuses a transaction whose fields were changed after hashing", () => {
        const tx = transaction()
        const tampered = { ...tx, Amount: 1500 }
        const err = errorOf(() => validateSignRequestParams(txItem(tampered), Network.Testnet))
        expect(err.code).toBe(ProviderErrorCode.InvalidParams)
        expect(err.message).toMatch(/hash does not match its fields/)
    })

    it("refuses a hash preimage that does not match the fields", () => {
        const tx = transaction()
        const err = errorOf(() => validateSignRequestParams(txItem(tx, { hashPreimage: "forged" }), Network.Testnet))
        expect(err.message).toMatch(/preimage/)
        expect(() =>
            validateSignRequestParams(txItem(tx, { hashPreimage: transactionHashPreimage(tx) }), Network.Testnet)
        ).not.toThrow()
    })

    it("refuses a message that is not the transaction hash", () => {
        const tx = transaction()
        const message = "cd".repeat(32)
        const item = { digestHex: sha256Hex(message), request: { ...txItem(tx).request, message } }
        expect(errorOf(() => validateSignRequestParams(item, Network.Testnet)).message).toMatch(/message does not match/)
    })

    it("refuses transaction types it cannot hash locally", () => {
        const tx = transaction({ TransactionType: 31, Hash: "ab".repeat(32) })
        expect(errorOf(() => validateSignRequestParams(txItem(tx), Network.Testnet)).message).toMatch(/cannot be checked/)
    })

    it("never signs a bare digest", () => {
        const err = errorOf(() => validateSignRequestParams({ digestHex: "ab".repeat(32) }, Network.Testnet))
        expect(err.code).toBe(ProviderErrorCode.InvalidParams)
        expect(err.message).toMatch(/bare digest/)
    })

    it("refuses plain messages and unknown kinds", () => {
        const message = "ab".repeat(32)
        const plain = { digestHex: sha256Hex(message), request: { kind: "message", flowId: FLOW, message } }
        expect(errorOf(() => validateSignRequestParams(plain, Network.Testnet)).message).toMatch(/vfx_signMessage/)
        const unknown = { digestHex: sha256Hex(message), request: { kind: "token-approval", flowId: FLOW, message } }
        expect(errorOf(() => validateSignRequestParams(unknown, Network.Testnet)).message).toMatch(/Unsupported/)
    })

    it("refuses a ceremony message that is not Core's format for its fields", () => {
        const item = ceremonyItem("start", 1_762_600_000)
        const message = `${item.request.sessionId}.${item.request.ownerAddress}.999`
        const forged = { digestHex: sha256Hex(message), request: { ...item.request, message } }
        expect(errorOf(() => validateSignRequestParams(forged, Network.Testnet)).message).toMatch(/message does not match/)
    })

    it("refuses an account on the other network", () => {
        const tx = transaction({ FromAddress: MAINNET_ACCOUNT.address })
        expect(errorOf(() => validateSignRequestParams(txItem(tx), Network.Testnet)).code).toBe(ProviderErrorCode.WrongNetwork)
    })

    it("drops fields the page attached beyond the request's own", () => {
        const item = txItem()
        const params = validateSignRequestParams(
            { ...item, request: { ...item.request, extra: "<script>", transaction: { ...item.request.transaction, Junk: 1 } } },
            Network.Testnet
        )
        expect(params.items[0].request).not.toHaveProperty("extra")
        expect((params.items[0].request as { transaction: object }).transaction).not.toHaveProperty("Junk")
    })
})

describe("decoding each request type", () => {
    it("transaction: type, to, amount, fee and data", () => {
        const tx = transaction({
            TransactionType: TxType.VbtcV2Transfer,
            ToAddress: OTHER.address,
            Amount: 0,
            Data: [{ Function: "TransferCoin()", ContractUID: "vault-uid-1", Amount: 0.25, ToAddress: OTHER.address }]
        })
        const { items } = validateSignRequestParams(txItem(tx), Network.Testnet)
        const display = describeSigningRequest(items[0].request)
        expect(display.title).toBe("Transfer vBTC")
        const rows = Object.fromEntries(display.rows.map((row) => [row.label, row.value]))
        expect(rows.To).toBe(OTHER.address)
        expect(rows.Amount).toBe("0 VFX")
        expect(rows["Network fee"]).toBe("0.00002 VFX")
        expect(rows["vBTC amount"]).toBe("0.25 vBTC")
        expect(rows["Data: Function"]).toBe("TransferCoin()")
        expect(rows["Data: ContractUID"]).toBe("vault-uid-1")
        expect(display.data).toContain("TransferCoin()")
    })

    it("a plain VFX send", () => {
        const { items } = validateSignRequestParams(txItem(), Network.Testnet)
        const display = describeSigningRequest(items[0].request)
        expect(display.title).toBe("Send VFX")
        expect(display.rows.find((row) => row.label === "Amount")?.value).toBe("1.5 VFX")
    })

    it("vbtc-ceremony", () => {
        const { items } = validateSignRequestParams(ceremonyItem("share", 1_762_600_001), Network.Testnet)
        const display = describeSigningRequest(items[0].request)
        expect(display.title).toMatch(/key ceremony \(share distribution\)/)
        expect(display.rows.find((row) => row.label === "Ceremony")?.value).toBe("vbtc-abc123")
    })

    it("vbtc-ownership", () => {
        const { items } = validateSignRequestParams(ownershipItem(), Network.Testnet)
        const rows = Object.fromEntries(describeSigningRequest(items[0].request).rows.map((row) => [row.label, row.value]))
        expect(rows.Name).toBe("My Vault")
        expect(rows.Ticker).toBe("VBTC")
    })

    it("frost-withdrawal, including extra inputs with or without the :i suffix on the session", () => {
        const withSuffix = frostItem("input", 1_762_600_000, 2, "sess-1:i2")
        const withoutSuffix = frostItem("input", 1_762_600_000, 2, "sess-1")
        for (const item of [withSuffix, withoutSuffix]) {
            const { items } = validateSignRequestParams(item, Network.Testnet)
            const display = describeSigningRequest(items[0].request)
            expect(display.title).toBe("vBTC withdrawal signing (input 2)")
            expect(display.rows.find((row) => row.label === "Vault")?.value).toBe("vault-uid-1")
        }
    })

    it("reserve-recovery", () => {
        const { items } = validateSignRequestParams(recoveryItem(), Network.Testnet)
        const display = describeSigningRequest(items[0].request)
        expect(display.title).toBe("Recover a reserve (vault) account")
        expect(display.rows.find((row) => row.label === "Funds go to")?.value).toBe(ACCOUNT.address)
    })
})

describe("batches", () => {
    it("accepts one flow's steps together", () => {
        const params = validateSignRequestParams(
            { flowId: FLOW, items: [ceremonyItem("start", 1_762_600_000), ceremonyItem("share", 1_762_600_001)] },
            Network.Testnet
        )
        expect(params.items).toHaveLength(2)
        expect(describeFlow(params.items)).toBe("Create a vBTC vault")
    })

    it("a multi-input withdrawal is one flow", () => {
        const params = validateSignRequestParams(
            {
                items: [
                    frostItem("start", 1_762_600_000),
                    frostItem("share", 1_762_600_001),
                    frostItem("input", 1_762_600_000, 1, "sess-1:i1"),
                    frostItem("input", 1_762_600_000, 2, "sess-1:i2")
                ]
            },
            Network.Testnet
        )
        expect(describeFlow(params.items)).toBe("Complete a vBTC withdrawal")
    })

    it("refuses items from different flows", () => {
        const other = ceremonyItem("share", 1_762_600_001)
        other.request.flowId = "different-flow"
        const err = errorOf(() => validateSignRequestParams({ items: [ceremonyItem("start", 1_762_600_000), other] }, Network.Testnet))
        expect(err.message).toMatch(/share one flowId/)
    })

    it("refuses a flowId that does not match its items", () => {
        const err = errorOf(() => validateSignRequestParams({ flowId: "x", items: [ceremonyItem("start", 1)] }, Network.Testnet))
        expect(err.message).toMatch(/flowId does not match/)
    })

    it("refuses items that sign for different addresses", () => {
        const err = errorOf(() =>
            validateSignRequestParams(
                { items: [ceremonyItem("start", 1), ceremonyItem("share", 2, OTHER.address)] },
                Network.Testnet
            )
        )
        expect(err.message).toMatch(/same address/)
    })

    it("refuses an empty or oversized batch", () => {
        expect(errorOf(() => validateSignRequestParams({ items: [] }, Network.Testnet)).message).toMatch(/empty/)
        const many = Array.from({ length: MAX_SIGNING_BATCH + 1 }, (_, index) => ceremonyItem("start", index))
        expect(errorOf(() => validateSignRequestParams({ items: many }, Network.Testnet)).message).toMatch(/At most/)
    })
})

describe("result checks", () => {
    const params = validateSignRequestParams(
        { items: [ceremonyItem("start", 1_762_600_000), ceremonyItem("share", 1_762_600_001)] },
        Network.Testnet
    )
    const sign = (message: string) => ({ signature: client.getSignature(message, PRIVATE_KEY) })

    it("returns each verified signature with its DER form", () => {
        const result = sanitizeSignRequestResult(params, { signatures: params.items.map((item) => sign(messageFor(item))) }, ACCOUNT.address)
        expect(result.flowId).toBe(FLOW)
        expect(result.signatures).toHaveLength(2)
        for (const [index, signed] of result.signatures.entries()) {
            expect(signed.digestHex).toBe(params.items[index].digestHex)
            expect(signed.der).toBe(Buffer.from(signed.signature.split(".")[0], "base64").toString("hex"))
            expect(signed.der.startsWith("30")).toBe(true)
        }
        expect(derHexFromSignature(result.signatures[0].signature)).toBe(result.signatures[0].der)
    })

    it("refuses a signature over anything else", () => {
        const signatures = [sign(messageFor(params.items[0])), sign("not the share message")]
        expect(() => sanitizeSignRequestResult(params, { signatures }, ACCOUNT.address)).toThrow(/does not verify/)
    })

    it("refuses the wrong number of signatures", () => {
        expect(() =>
            sanitizeSignRequestResult(params, { signatures: [sign(messageFor(params.items[0]))] }, ACCOUNT.address)
        ).toThrow(/Wrong number/)
    })

    it("refuses when the wallet's account is not the one the request signs for", () => {
        const signatures = params.items.map((item) => sign(messageFor(item)))
        expect(() => sanitizeSignRequestResult(params, { signatures }, OTHER.address)).toThrow(/does not match/)
    })
})

// Requests captured from vfx-web-sdk feat/nft-and-vault-recovery @2d4d633
// (the web wallet's vendored build); see tests/fixtures/nftSigningVectors.json.
describe("NFT and Spyglass requests (SDK @2d4d633)", () => {
    const vector = (kind: string) => NFT_VECTORS.vectors.find((v) => v.request.kind === kind)!
    // The time inside the captured proof and sign-in messages.
    const NOW = 1_794_199_399
    const sign = (message: string) => ({ signature: client.getSignature(message, PRIVATE_KEY) })
    const withMessage = (kind: string, message: string) => ({
        digestHex: sha256Hex(message),
        request: { ...vector(kind).request, message }
    })

    it("accepts each kind exactly as the SDK sends it, signed by the approving account", () => {
        for (const kind of ["nft-beacon-upload", "nft-ownership-proof", "spyglass-auth"]) {
            const v = vector(kind)
            expect(v.digestHex).toBe(sha256Hex(v.request.message))
            const params = validateSignRequestParams(v, Network.Testnet, NOW)
            expect(params.signerAddress).toBeNull()
            expect(messageFor(params.items[0])).toBe(v.request.message)
            const result = sanitizeSignRequestResult(params, { signatures: [sign(v.request.message)] }, ACCOUNT.address)
            expect(result.signatures[0].digestHex).toBe(v.digestHex)
        }
    })

    it("nft-beacon-upload: the message must be exactly the contract id", () => {
        const v = vector("nft-beacon-upload")
        expect(v.request.message).toBe(v.request.scIdentifier)
        const other = withMessage("nft-beacon-upload", `${v.request.scIdentifier} `)
        expect(errorOf(() => validateSignRequestParams(other, Network.Testnet, NOW)).message).toMatch(/message does not match/)
        const retargeted = { ...v, request: { ...v.request, scIdentifier: "other:1" } }
        expect(errorOf(() => validateSignRequestParams(retargeted, Network.Testnet, NOW)).code).toBe(ProviderErrorCode.InvalidParams)
        const badRecipient = { ...v, request: { ...v.request, toAddress: "not-an-address" } }
        expect(errorOf(() => validateSignRequestParams(badRecipient, Network.Testnet, NOW)).code).toBe(ProviderErrorCode.InvalidParams)
        expect(describeSigningRequest(validateSignRequestParams(v, Network.Testnet, NOW).items[0].request).rows).toEqual(
            expect.arrayContaining([{ label: "Files go to", value: v.request.toAddress, mono: true }])
        )
    })

    it("nft-ownership-proof and spyglass-auth: only <nonce>.<unix time> in the SDK's shape", () => {
        for (const message of ["hello", "LGQBXuiP.", "LGQBXuiP.17941993x9", "LGQBXui.1794199399", "LGQBXuiP1.1794199399", "ab".repeat(32)]) {
            const item = withMessage("nft-ownership-proof", message)
            expect(errorOf(() => validateSignRequestParams(item, Network.Testnet, NOW)).code).toBe(ProviderErrorCode.InvalidParams)
        }
        // A proof-shaped message is not a sign-in message, and the reverse.
        expect(errorOf(() => validateSignRequestParams(withMessage("spyglass-auth", "LGQBXuiP.1794199399"), Network.Testnet, NOW)).code).toBe(
            ProviderErrorCode.InvalidParams
        )
        expect(
            errorOf(() => validateSignRequestParams(withMessage("nft-ownership-proof", "hBMcrNsfMhsodzcn.1794199399"), Network.Testnet, NOW)).code
        ).toBe(ProviderErrorCode.InvalidParams)
    })

    it("refuses a proof or sign-in more than 10 minutes from the extension's clock", () => {
        for (const kind of ["nft-ownership-proof", "spyglass-auth"]) {
            const v = vector(kind)
            expect(validateSignRequestParams(v, Network.Testnet, NOW + 600).items).toHaveLength(1)
            expect(validateSignRequestParams(v, Network.Testnet, NOW - 600).items).toHaveLength(1)
            expect(errorOf(() => validateSignRequestParams(v, Network.Testnet, NOW + 601)).message).toMatch(/10 minutes/)
            expect(errorOf(() => validateSignRequestParams(v, Network.Testnet, NOW - 601)).message).toMatch(/10 minutes/)
        }
    })

    it("spyglass-auth is never batched with anything else", () => {
        const auth = vector("spyglass-auth")
        const proof = { ...vector("nft-ownership-proof"), request: { ...vector("nft-ownership-proof").request, flowId: auth.request.flowId } }
        const batch = { items: [auth, proof] }
        expect(errorOf(() => validateSignRequestParams(batch, Network.Testnet, NOW)).message).toMatch(/on its own/)
        expect(errorOf(() => validateSignRequestParams({ items: [auth, auth] }, Network.Testnet, NOW)).message).toMatch(/on its own/)
    })

    it("an address-free item in a batch still binds to the batch's account", () => {
        const tx = txItem()
        const beacon = { ...vector("nft-beacon-upload"), request: { ...vector("nft-beacon-upload").request, flowId: FLOW } }
        const params = validateSignRequestParams({ items: [beacon, tx] }, Network.Testnet, NOW)
        expect(params.signerAddress).toBe(ACCOUNT.address)
        const signatures = params.items.map((item) => sign(messageFor(item)))
        expect(() => sanitizeSignRequestResult(params, { signatures }, OTHER.address)).toThrow(/does not match/)
    })

    it("refuses a signature by any account other than the approving one", () => {
        const v = vector("spyglass-auth")
        const params = validateSignRequestParams(v, Network.Testnet, NOW)
        const otherKey = client.generatePrivateKey()
        const forged = { signature: client.getSignature(v.request.message, otherKey) }
        expect(() => sanitizeSignRequestResult(params, { signatures: [forged] }, ACCOUNT.address)).toThrow(/does not verify/)
    })

    it("titles each kind for the popup", () => {
        expect(describeFlow(validateSignRequestParams(vector("nft-beacon-upload"), Network.Testnet, NOW).items)).toMatch(/NFT's files/)
        expect(describeFlow(validateSignRequestParams(vector("nft-ownership-proof"), Network.Testnet, NOW).items)).toMatch(/own an NFT/)
        expect(describeFlow(validateSignRequestParams(vector("spyglass-auth"), Network.Testnet, NOW).items)).toBe("Sign in to Spyglass")
    })
})
