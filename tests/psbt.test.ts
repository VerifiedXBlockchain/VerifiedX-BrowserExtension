import * as ecc from "@bitcoinerlab/secp256k1"
import * as bitcoin from "bitcoinjs-lib"
import { ECPairFactory } from "ecpair"
import { describe, expect, it } from "vitest"

import { ProviderErrorCode } from "~lib/provider/protocol"
import {
    btcAccountFromWif,
    sanitizeSignPsbtResult,
    signPsbt,
    summarizePsbt,
    validateSignPsbtParams,
    type SignPsbtParams
} from "~lib/provider/psbt"
import { Network } from "~types/types"

const ECPair = ECPairFactory(ecc)
const TESTNET = bitcoin.networks.testnet
const WALLET = ECPair.makeRandom({ network: TESTNET })
const STRANGER = ECPair.makeRandom({ network: TESTNET })
const WALLET_WIF = WALLET.toWIF()
const WALLET_ACCOUNT = btcAccountFromWif(WALLET_WIF, Network.Testnet)
const STRANGER_ACCOUNT = btcAccountFromWif(STRANGER.toWIF(), Network.Testnet)
const RECIPIENT = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(ECPair.makeRandom({ network: TESTNET }).publicKey), network: TESTNET }).address

function script(address: string): Buffer {
    return bitcoin.address.toOutputScript(address, TESTNET)
}

interface BuildOptions {
    foreignInput?: boolean
    sighashType?: number
    noUtxo?: boolean
    opReturn?: string
}

// One 100,000-sat wallet input; 60,000 to the recipient, 39,000 change.
function buildPsbt(options: BuildOptions = {}): string {
    const psbt = new bitcoin.Psbt({ network: TESTNET })
    psbt.addInput({
        hash: "11".repeat(32),
        index: 0,
        sequence: 0xfffffffd,
        ...(!options.noUtxo && { witnessUtxo: { script: script(WALLET_ACCOUNT.address), value: 100_000 } }),
        ...(options.sighashType !== undefined && { sighashType: options.sighashType })
    })
    if (options.foreignInput) {
        psbt.addInput({ hash: "22".repeat(32), index: 1, witnessUtxo: { script: script(STRANGER_ACCOUNT.address), value: 50_000 } })
    }
    psbt.addOutput({ address: RECIPIENT, value: options.foreignInput ? 110_000 : 60_000 })
    psbt.addOutput({ address: WALLET_ACCOUNT.address, value: 39_000 })
    if (options.opReturn) {
        psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from(options.opReturn)] }).output, value: 0 })
    }
    return psbt.toBase64()
}

function params(psbt: string, extra: Record<string, unknown> = {}): SignPsbtParams {
    return validateSignPsbtParams({ psbt, ...extra }, Network.Testnet)
}

function errorOf(fn: () => unknown): { code?: number; message?: string } {
    try {
        fn()
    } catch (err) {
        return err as { code?: number; message?: string }
    }
    throw new Error("expected a throw")
}

describe("PSBT summary", () => {
    it("shows inputs, outputs, fee, change and what leaves the wallet", () => {
        const summary = summarizePsbt(params(buildPsbt()), WALLET_ACCOUNT.publicKey)
        expect(summary.inputs).toEqual([
            { index: 0, txid: "11".repeat(32), vout: 0, valueSats: 100_000, address: WALLET_ACCOUNT.address, mine: true }
        ])
        expect(summary.outputs.map((output) => [output.address, output.valueSats, output.mine])).toEqual([
            [RECIPIENT, 60_000, false],
            [WALLET_ACCOUNT.address, 39_000, true]
        ])
        expect(summary.feeSats).toBe(1_000)
        expect(summary.changeSats).toBe(39_000)
        expect(summary.sentSats).toBe(61_000)
        expect(summary.signInputs).toEqual([0])
        // 1-in 2-out P2WPKH is about 141 vB
        expect(summary.feeRateSatVb).toBeGreaterThan(6)
        expect(summary.feeRateSatVb).toBeLessThan(8)
        expect(summary.warnings).toEqual([])
    })

    it("decodes an OP_RETURN output", () => {
        const summary = summarizePsbt(params(buildPsbt({ opReturn: "vault" })), WALLET_ACCOUNT.publicKey)
        const opReturn = summary.outputs[2]
        expect(opReturn.address).toBeNull()
        expect(opReturn.opReturnHex).toBe(Buffer.from("vault").toString("hex"))
    })

    it("accepts hex as well as base64", () => {
        const hex = Buffer.from(buildPsbt(), "base64").toString("hex")
        expect(params(hex).psbt).toBe(buildPsbt())
    })

    it("signs only the wallet's inputs and warns about the others", () => {
        const summary = summarizePsbt(params(buildPsbt({ foreignInput: true })), WALLET_ACCOUNT.publicKey)
        expect(summary.signInputs).toEqual([0])
        expect(summary.inputs[1].mine).toBe(false)
        expect(summary.warnings.join(" ")).toMatch(/belong to someone else/)
    })

    it("refuses to sign an input the wallet does not own", () => {
        const err = errorOf(() => summarizePsbt(params(buildPsbt({ foreignInput: true }), { signInputs: [1] }), WALLET_ACCOUNT.publicKey))
        expect(err.message).toMatch(/does not belong to this wallet/)
    })

    it("refuses a PSBT with nothing for this wallet to sign", () => {
        expect(errorOf(() => summarizePsbt(params(buildPsbt()), STRANGER_ACCOUNT.publicKey)).message).toMatch(/None of the PSBT's inputs/)
    })
})

describe("PSBT validation", () => {
    it("refuses an input that does not say what it spends", () => {
        expect(errorOf(() => params(buildPsbt({ noUtxo: true }))).message).toMatch(/does not say what it spends/)
    })

    it("refuses sighash types other than SIGHASH_ALL", () => {
        const psbt = buildPsbt({ sighashType: bitcoin.Transaction.SIGHASH_NONE })
        expect(errorOf(() => params(psbt)).message).toMatch(/SIGHASH_ALL/)
    })

    it("refuses garbage and the wrong network", () => {
        expect(errorOf(() => params("not a psbt")).code).toBe(ProviderErrorCode.InvalidParams)
        expect(errorOf(() => validateSignPsbtParams({ psbt: buildPsbt(), network: "mainnet" }, Network.Testnet)).code).toBe(
            ProviderErrorCode.WrongNetwork
        )
    })
})

describe("PSBT signing and result checks", () => {
    it("returns a PSBT with the wallet's signature that the background accepts", () => {
        const request = params(buildPsbt())
        const signed = signPsbt(request, WALLET_WIF)
        expect(signed.txHex).toBeUndefined()
        const result = sanitizeSignPsbtResult(request, signed, WALLET_ACCOUNT.publicKey)
        expect(result.signedInputs).toEqual([0])
        const psbt = bitcoin.Psbt.fromBase64(result.psbt, { network: TESTNET })
        expect(psbt.data.inputs[0].partialSig).toHaveLength(1)
    })

    it("finalises and returns the raw transaction when asked", () => {
        const request = params(buildPsbt(), { finalize: true })
        const signed = signPsbt(request, WALLET_WIF)
        const result = sanitizeSignPsbtResult(request, signed, WALLET_ACCOUNT.publicKey)
        expect(result.txHex).toBe(signed.txHex)
        expect(result.txid).toBe(bitcoin.Transaction.fromHex(result.txHex).getId())
    })

    it("refuses a signed PSBT that describes a different transaction", () => {
        const request = params(buildPsbt())
        const other = bitcoin.Psbt.fromBase64(buildPsbt(), { network: TESTNET })
        other.addOutput({ address: RECIPIENT, value: 1 })
        expect(() => sanitizeSignPsbtResult(request, { psbt: other.toBase64() }, WALLET_ACCOUNT.publicKey)).toThrow(/different transaction/)
    })

    it("refuses a signature from another key, or one that does not verify", () => {
        const request = params(buildPsbt())
        const genuine = bitcoin.Psbt.fromBase64(signPsbt(request, WALLET_WIF).psbt, { network: TESTNET })
        const signature = genuine.data.inputs[0].partialSig[0].signature

        const otherKey = bitcoin.Psbt.fromBase64(request.psbt, { network: TESTNET })
        otherKey.updateInput(0, { partialSig: [{ pubkey: Buffer.from(STRANGER.publicKey), signature }] })
        expect(() => sanitizeSignPsbtResult(request, { psbt: otherKey.toBase64() }, WALLET_ACCOUNT.publicKey)).toThrow(
            /not signed by this wallet/
        )

        // A valid signature over a different message, presented as the wallet's.
        const elsewhere = bitcoin.script.signature.encode(
            Buffer.from(WALLET.sign(Buffer.alloc(32, 7))),
            bitcoin.Transaction.SIGHASH_ALL
        )
        const bad = bitcoin.Psbt.fromBase64(request.psbt, { network: TESTNET })
        bad.updateInput(0, { partialSig: [{ pubkey: Buffer.from(WALLET.publicKey), signature: elsewhere }] })
        expect(() => sanitizeSignPsbtResult(request, { psbt: bad.toBase64() }, WALLET_ACCOUNT.publicKey)).toThrow(/invalid signature/)
    })

    it("refuses an unsigned result", () => {
        const request = params(buildPsbt())
        expect(() => sanitizeSignPsbtResult(request, { psbt: request.psbt }, WALLET_ACCOUNT.publicKey)).toThrow(/not signed/)
    })
})
