// btc_signPsbt: Bitcoin PSBT signing for the wallet's BTC and vBTC flows.
//
// A site sends an unsigned PSBT (BIP 174, base64 or hex). The background
// parses it before a popup opens and refuses one the popup could not show
// truthfully: an input without its previous output, a sighash other than
// SIGHASH_ALL, or more inputs or outputs than fit on screen. The popup lists
// every input and output, marks which belong to the wallet, works out the
// fee and the change, and signs only the wallet's own inputs. The background
// then checks the signed PSBT still describes the same transaction and that
// every signature the popup added is the wallet key's and verifies.
//
// The VerifiedX testnet's Bitcoin side is a signet, which uses testnet
// address formats, so testnet maps to bitcoinjs-lib's testnet parameters.
//
// Pure, so it can be unit tested.

import * as ecc from "@bitcoinerlab/secp256k1"
import * as bitcoin from "bitcoinjs-lib"
import bs58check from "bs58check"

import { ProviderError, ProviderErrorCode } from "~lib/provider/protocol"
import { Network } from "~types/types"

export const MAX_PSBT_INPUTS = 64
export const MAX_PSBT_OUTPUTS = 32
const MAX_PSBT_BYTES = 200_000
const SIGHASH_ALL = bitcoin.Transaction.SIGHASH_ALL
const DUST_LIMIT_SATS = 546

export interface BtcAccount {
    // Native SegWit (P2WPKH) address, the one the wallet spends from.
    address: string
    // Compressed public key, hex.
    publicKey: string
    network: Network
}

export interface SignPsbtParams {
    // Normalised to base64.
    psbt: string
    // Finalise the signed inputs and return the raw transaction when every
    // input is then complete.
    finalize: boolean
    // Indexes to sign; every wallet-owned input when absent.
    signInputs: number[] | null
    network: Network
}

export interface PsbtInputView {
    index: number
    txid: string
    vout: number
    valueSats: number
    address: string | null
    mine: boolean
}

export interface PsbtOutputView {
    index: number
    valueSats: number
    // null for a script with no address (OP_RETURN and the like).
    address: string | null
    // The decoded OP_RETURN payload as hex, when the output is one.
    opReturnHex?: string
    mine: boolean
}

export interface PsbtSummary {
    inputs: PsbtInputView[]
    outputs: PsbtOutputView[]
    totalInSats: number
    totalOutSats: number
    feeSats: number
    // Estimated from the transaction's size once signed; approximate.
    feeRateSatVb: number
    // What leaves the wallet: its inputs minus the outputs paying it back.
    sentSats: number
    changeSats: number
    // Inputs the popup will sign.
    signInputs: number[]
    warnings: string[]
}

export interface SignPsbtResult {
    psbt: string
    signedInputs: number[]
    // Present when finalize was asked for and every input is complete.
    txHex?: string
    txid?: string
}

function invalid(message: string): never {
    throw new ProviderError(ProviderErrorCode.InvalidParams, message)
}

export function btcNetworkParams(network: Network): bitcoin.Network {
    return network === Network.Mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
}

export function decodePsbt(text: string, network: Network): bitcoin.Psbt {
    const trimmed = text.trim()
    const opts = { network: btcNetworkParams(network) }
    try {
        return /^[0-9a-fA-F]+$/.test(trimmed) ? bitcoin.Psbt.fromHex(trimmed, opts) : bitcoin.Psbt.fromBase64(trimmed, opts)
    } catch (err) {
        invalid(`psbt is not a valid PSBT: ${err instanceof Error ? err.message : String(err)}`)
    }
}

// The previous output an input spends, from its witnessUtxo or, failing
// that, its full previous transaction (whose hash must match the input).
function prevout(psbt: bitcoin.Psbt, index: number): { script: Buffer; value: number } {
    const input = psbt.data.inputs[index]
    const txInput = psbt.txInputs[index]
    if (input.witnessUtxo) return { script: input.witnessUtxo.script, value: input.witnessUtxo.value }
    if (input.nonWitnessUtxo) {
        const previous = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo)
        if (!previous.getHash().equals(txInput.hash)) invalid(`Input ${index}: the previous transaction does not match`)
        const output = previous.outs[txInput.index]
        if (!output) invalid(`Input ${index}: the previous transaction has no output ${txInput.index}`)
        return { script: output.script, value: output.value }
    }
    invalid(`Input ${index} does not say what it spends (no witnessUtxo or nonWitnessUtxo)`)
}

function addressOf(script: Buffer, network: Network): string | null {
    try {
        return bitcoin.address.fromOutputScript(script, btcNetworkParams(network))
    } catch {
        return null
    }
}

function opReturnHex(script: Buffer): string | undefined {
    if (script[0] !== bitcoin.opcodes.OP_RETURN) return undefined
    const chunks = bitcoin.script.decompile(script) ?? []
    return chunks
        .slice(1)
        .map((chunk) => (Buffer.isBuffer(chunk) ? chunk.toString("hex") : ""))
        .join("")
}

export function validateSignPsbtParams(params: unknown, activeNetwork: Network): SignPsbtParams {
    const value = params as Record<string, unknown> | null
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected { psbt }")

    if (value.network !== undefined) {
        if (value.network !== Network.Mainnet && value.network !== Network.Testnet) {
            invalid('network must be "mainnet" or "testnet"')
        }
        if (value.network !== activeNetwork) {
            throw new ProviderError(
                ProviderErrorCode.WrongNetwork,
                `The wallet is on ${activeNetwork}; switch networks in the extension to continue`
            )
        }
    }

    if (typeof value.psbt !== "string" || value.psbt.length === 0 || value.psbt.length > MAX_PSBT_BYTES * 2) {
        invalid("psbt must be a base64 or hex string")
    }
    const psbt = decodePsbt(value.psbt, activeNetwork)

    if (psbt.inputCount === 0) invalid("The PSBT has no inputs")
    if (psbt.inputCount > MAX_PSBT_INPUTS) invalid(`The PSBT has more than ${MAX_PSBT_INPUTS} inputs`)
    if (psbt.txOutputs.length === 0) invalid("The PSBT has no outputs")
    if (psbt.txOutputs.length > MAX_PSBT_OUTPUTS) invalid(`The PSBT has more than ${MAX_PSBT_OUTPUTS} outputs`)

    let totalIn = 0
    for (let index = 0; index < psbt.inputCount; index++) {
        const input = psbt.data.inputs[index]
        if (input.sighashType !== undefined && input.sighashType !== SIGHASH_ALL) {
            invalid(`Input ${index} asks for a sighash other than SIGHASH_ALL`)
        }
        totalIn += prevout(psbt, index).value
    }
    const totalOut = psbt.txOutputs.reduce((sum, output) => sum + output.value, 0)
    if (totalOut > totalIn) invalid("The PSBT's outputs are worth more than its inputs")

    let signInputs: number[] | null = null
    if (value.signInputs !== undefined && value.signInputs !== null) {
        if (!Array.isArray(value.signInputs) || value.signInputs.length === 0) invalid("signInputs must be a non-empty array")
        const unique = new Set<number>()
        for (const index of value.signInputs) {
            if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= psbt.inputCount) {
                invalid("signInputs must list input indexes in the PSBT")
            }
            unique.add(index)
        }
        signInputs = [...unique].sort((a, b) => a - b)
    }

    if (value.finalize !== undefined && typeof value.finalize !== "boolean") invalid("finalize must be a boolean")

    return { psbt: psbt.toBase64(), finalize: value.finalize === true, signInputs, network: activeNetwork }
}

// Rough virtual size once signed: P2WPKH inputs at 68 vB, anything else at a
// legacy P2PKH's 148 vB, plus each output's own size and the fixed overhead.
function estimateVsize(psbt: bitcoin.Psbt, inputScripts: Buffer[]): number {
    const inputs = inputScripts.reduce((sum, script) => sum + (isP2wpkh(script) ? 68 : 148), 0)
    const outputs = psbt.txOutputs.reduce((sum, output) => sum + 9 + output.script.length, 0)
    return Math.ceil(10.5 + inputs + outputs)
}

function isP2wpkh(script: Buffer): boolean {
    return script.length === 22 && script[0] === 0x00 && script[1] === 0x14
}

export function walletScript(publicKeyHex: string, network: Network): Buffer {
    const { output } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(publicKeyHex, "hex"), network: btcNetworkParams(network) })
    return output
}

// The 32-byte key in a WIF: version byte, key, and 0x01 when compressed.
export function privateKeyFromWif(wif: string, network: Network): Buffer {
    const payload = Buffer.from(bs58check.decode(wif))
    if (payload[0] !== btcNetworkParams(network).wif) throw new Error("The Bitcoin key is for another network")
    if (payload.length !== 33 && !(payload.length === 34 && payload[33] === 0x01)) throw new Error("Invalid Bitcoin key")
    const privateKey = payload.subarray(1, 33)
    if (!ecc.isPrivate(privateKey)) throw new Error("Invalid Bitcoin key")
    return privateKey
}

// A bitcoinjs signer for a WIF, always with the compressed public key the
// wallet's P2WPKH address uses. (ecpair is not used here: its WIF
// dependency chain does not bundle under Plasmo.)
function keyPairFromWif(wif: string, network: Network): bitcoin.Signer {
    const privateKey = privateKeyFromWif(wif, network)
    return {
        publicKey: Buffer.from(ecc.pointFromScalar(privateKey, true)),
        sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, privateKey))
    }
}

// The account a WIF spends from: its P2WPKH address and compressed key.
export function btcAccountFromWif(wif: string, network: Network): BtcAccount {
    const pubkey = keyPairFromWif(wif, network).publicKey
    const { address } = bitcoin.payments.p2wpkh({ pubkey, network: btcNetworkParams(network) })
    return { address, publicKey: pubkey.toString("hex"), network }
}

// What the popup shows. `publicKeyHex` is the wallet's compressed BTC key.
export function summarizePsbt(params: SignPsbtParams, publicKeyHex: string): PsbtSummary {
    const { network } = params
    const psbt = decodePsbt(params.psbt, network)
    const mine = walletScript(publicKeyHex, network)

    const inputScripts: Buffer[] = []
    const inputs: PsbtInputView[] = psbt.txInputs.map((txInput, index) => {
        const { script, value } = prevout(psbt, index)
        inputScripts.push(script)
        return {
            index,
            txid: Buffer.from(txInput.hash).reverse().toString("hex"),
            vout: txInput.index,
            valueSats: value,
            address: addressOf(script, network),
            mine: script.equals(mine)
        }
    })
    const outputs: PsbtOutputView[] = psbt.txOutputs.map((output, index) => ({
        index,
        valueSats: output.value,
        address: addressOf(output.script, network),
        ...(opReturnHex(output.script) !== undefined && { opReturnHex: opReturnHex(output.script) }),
        mine: output.script.equals(mine)
    }))

    const owned = inputs.filter((input) => input.mine).map((input) => input.index)
    const signInputs = params.signInputs ?? owned
    const notMine = signInputs.filter((index) => !inputs[index].mine)
    if (signInputs.length === 0) invalid("None of the PSBT's inputs belong to this wallet")
    if (notMine.length > 0) invalid(`Input ${notMine.join(", ")} does not belong to this wallet`)

    const totalInSats = inputs.reduce((sum, input) => sum + input.valueSats, 0)
    const totalOutSats = outputs.reduce((sum, output) => sum + output.valueSats, 0)
    const feeSats = totalInSats - totalOutSats
    const ownedIn = inputs.filter((input) => input.mine).reduce((sum, input) => sum + input.valueSats, 0)
    const changeSats = outputs.filter((output) => output.mine).reduce((sum, output) => sum + output.valueSats, 0)
    const feeRateSatVb = Math.round((feeSats / estimateVsize(psbt, inputScripts)) * 10) / 10

    const warnings: string[] = []
    if (inputs.some((input) => !input.mine)) {
        warnings.push("Some inputs belong to someone else. Only this wallet's inputs are signed.")
    }
    if (feeRateSatVb > 500) warnings.push(`The fee rate is very high (about ${feeRateSatVb} sat/vB).`)
    const spent = totalOutSats - changeSats
    if (spent > 0 && feeSats > spent) warnings.push("The fee is larger than the amount being sent.")
    if (outputs.some((output) => output.address !== null && output.valueSats < DUST_LIMIT_SATS)) {
        warnings.push(`An output is below the ${DUST_LIMIT_SATS}-sat dust limit and may not relay.`)
    }

    return {
        inputs,
        outputs,
        totalInSats,
        totalOutSats,
        feeSats,
        feeRateSatVb,
        sentSats: ownedIn - changeSats,
        changeSats,
        signInputs,
        warnings
    }
}

// Signs the wallet's inputs. Runs in the popup with the decrypted WIF.
export function signPsbt(params: SignPsbtParams, wif: string): SignPsbtResult {
    const { network } = params
    const keyPair = keyPairFromWif(wif, network)
    const publicKeyHex = keyPair.publicKey.toString("hex")
    const { signInputs } = summarizePsbt(params, publicKeyHex)

    const psbt = decodePsbt(params.psbt, network)
    for (const index of signInputs) psbt.signInput(index, keyPair, [SIGHASH_ALL])

    if (params.finalize) {
        for (const index of signInputs) psbt.finalizeInput(index)
        const complete = psbt.data.inputs.every((input) => input.finalScriptWitness || input.finalScriptSig)
        if (complete) {
            const tx = psbt.extractTransaction()
            return { psbt: psbt.toBase64(), signedInputs: signInputs, txHex: tx.toHex(), txid: tx.getId() }
        }
    }
    return { psbt: psbt.toBase64(), signedInputs: signInputs }
}

function unsignedTxHex(psbt: bitcoin.Psbt): string {
    return (psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer }).toBuffer().toString("hex")
}

// Rebuilds the result from the requested PSBT, taking only the wallet's
// signatures from the popup's copy: the transaction cannot change, nothing
// else the popup's PSBT carries is passed on, and each signature must be the
// wallet key's and verify before it is used.
export function sanitizeSignPsbtResult(params: SignPsbtParams, raw: unknown, publicKeyHex: string): SignPsbtResult {
    const value = raw as Record<string, unknown> | null
    const fail = (message: string): never => {
        throw new ProviderError(ProviderErrorCode.Internal, message)
    }
    if (!value || typeof value.psbt !== "string") fail("Missing PSBT in result")

    const { network } = params
    const rebuilt = decodePsbt(params.psbt, network)
    let signed: bitcoin.Psbt
    try {
        signed = decodePsbt(value.psbt as string, network)
    } catch {
        fail("Invalid PSBT in result")
    }
    if (unsignedTxHex(signed) !== unsignedTxHex(rebuilt)) fail("The signed PSBT is a different transaction")

    const { signInputs } = summarizePsbt(params, publicKeyHex)
    const walletKey = Buffer.from(publicKeyHex, "hex")
    const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) => ecc.verify(msghash, pubkey, signature)

    let finalised = 0
    for (const index of signInputs) {
        const input = signed.data.inputs[index]
        let signature: Buffer
        if (input.finalScriptWitness) {
            // A finalised P2WPKH input carries [signature, pubkey].
            const witness = witnessStack(input.finalScriptWitness)
            if (witness.length !== 2 || !witness[1].equals(walletKey)) fail(`Input ${index} is not signed by this wallet`)
            signature = witness[0]
            finalised++
        } else {
            const sigs = input.partialSig ?? []
            if (sigs.length !== 1 || !Buffer.from(sigs[0].pubkey).equals(walletKey)) {
                fail(`Input ${index} is not signed by this wallet`)
            }
            signature = Buffer.from(sigs[0].signature)
        }
        rebuilt.updateInput(index, { partialSig: [{ pubkey: walletKey, signature }] })
        let valid = false
        try {
            valid = rebuilt.validateSignaturesOfInput(index, validator, walletKey)
        } catch {
            valid = false
        }
        if (!valid) fail(`Input ${index} has an invalid signature`)
    }

    if (finalised > 0 && (!params.finalize || finalised !== signInputs.length)) fail("Unexpected finalised inputs in result")
    if (!params.finalize) return { psbt: rebuilt.toBase64(), signedInputs: signInputs }

    for (const index of signInputs) rebuilt.finalizeInput(index)
    const result: SignPsbtResult = { psbt: rebuilt.toBase64(), signedInputs: signInputs }
    const complete = rebuilt.data.inputs.every((input) => input.finalScriptWitness || input.finalScriptSig)
    if (complete) {
        const tx = rebuilt.extractTransaction()
        result.txHex = tx.toHex()
        result.txid = tx.getId()
    }
    return result
}

// A serialised witness ("count, then length-prefixed items") as its items.
function witnessStack(serialised: Buffer): Buffer[] {
    const items: Buffer[] = []
    let offset = 0
    const readVarInt = (): number => {
        const first = serialised[offset++]
        if (first < 0xfd) return first
        if (first === 0xfd) {
            const value = serialised.readUInt16LE(offset)
            offset += 2
            return value
        }
        throw new ProviderError(ProviderErrorCode.Internal, "Unexpected witness size")
    }
    const count = readVarInt()
    for (let i = 0; i < count; i++) {
        const length = readVarInt()
        items.push(serialised.subarray(offset, offset + length))
        offset += length
    }
    return items
}
