import { Storage } from "@plasmohq/storage"
import { Network, Currency, type IBtcKeypair } from "~types/types"


const storage = new Storage()

let lastResetAt = 0
const UNLOCK_DURATION_MS = 5 * 60 * 1000 // 5 minutes

// Helper to encode text as Uint8Array
function encode(str: string) {
    return new TextEncoder().encode(str)
}

// Helper to decode Uint8Array as text
function decode(buf: ArrayBuffer) {
    return new TextDecoder().decode(buf)
}

// Derive a cryptographic key from a password
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey(
        "raw",
        encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    )

    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100_000,
            hash: "SHA-256",
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    )
}


export async function encryptPrivateKey(privateKey: string, password: string, network: Network, currency: Currency = Currency.VFX) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(password, salt)

    const cipherText = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encode(privateKey)
    )

    const encryptedData = {
        salt: Array.from(salt),
        iv: Array.from(iv),
        cipherText: Array.from(new Uint8Array(cipherText)),
    }

    await storage.set(`${currency}-${network}-wallet`, encryptedData)
}

export async function decryptPrivateKey(password: string, network: Network, currency: Currency = Currency.VFX): Promise<string> {
    const result = await storage.get(`${currency}-${network}-wallet`)

    if (!result) {
        throw new Error("No wallet found")
    }

    const { salt, iv, cipherText } = result as any
    const key = await deriveKey(password, new Uint8Array(salt))

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        key,
        new Uint8Array(cipherText)
    )

    return decode(decrypted)
}

export async function isWalletCreated(network: Network, currency: Currency = Currency.VFX): Promise<boolean> {
    const result = await storage.get(`${currency}-${network}-wallet`)
    return !!result
}

// Check if any wallet exists across both networks (for global password system)
export async function hasAnyWallet(): Promise<boolean> {
    const vfxMainnet = await storage.get(`${Currency.VFX}-${Network.Mainnet}-wallet`)
    const vfxTestnet = await storage.get(`${Currency.VFX}-${Network.Testnet}-wallet`)
    const btcMainnet = await storage.get(`${Currency.BTC}-${Network.Mainnet}-wallet`)
    const btcTestnet = await storage.get(`${Currency.BTC}-${Network.Testnet}-wallet`)
    return !!(vfxMainnet || vfxTestnet || btcMainnet || btcTestnet)
}

export async function clearWallet(network: Network, currency: Currency = Currency.VFX) {
    await storage.remove(`${currency}-${network}-wallet`)
}

// BTC-specific functions
export async function encryptBtcKeypair(keypair: IBtcKeypair, password: string, network: Network) {
    // Store the WIF as the main private key for BTC
    await encryptPrivateKey(keypair.wif, password, network, Currency.BTC)

    // Also store the full keypair data for convenience
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(password, salt)

    const cipherText = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encode(JSON.stringify(keypair))
    )

    const encryptedData = {
        salt: Array.from(salt),
        iv: Array.from(iv),
        cipherText: Array.from(new Uint8Array(cipherText)),
    }

    await storage.set(`${Currency.BTC}-${network}-keypair`, encryptedData)
}

export async function decryptBtcKeypair(password: string, network: Network): Promise<IBtcKeypair> {
    const result = await storage.get(`${Currency.BTC}-${network}-keypair`)

    if (!result) {
        throw new Error("No BTC wallet found")
    }

    const { salt, iv, cipherText } = result as any
    const key = await deriveKey(password, new Uint8Array(salt))

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        key,
        new Uint8Array(cipherText)
    )

    return JSON.parse(decode(decrypted)) as IBtcKeypair
}


export async function setUnlocked(state: boolean) {
    if (state) {
        const unlockUntil = Date.now() + UNLOCK_DURATION_MS
        await storage.set("unlockedUntil", unlockUntil)
    } else {
        console.log("removing unlockedUntil")
        await storage.remove("unlockedUntil")
    }
}

export async function isUnlocked(): Promise<boolean> {
    const unlockUntil = await storage.get<number>("unlockedUntil")
    console.log(unlockUntil)

    if (!unlockUntil) return false

    if (Date.now() > unlockUntil) {
        await storage.remove("unlockedUntil")
        return false
    }

    return true
}


export async function resetUnlockTimer() {
    const now = Date.now()

    if (now - lastResetAt < 30_000) {
        return
    }

    const unlockUntil = now + UNLOCK_DURATION_MS
    await storage.set("unlockedUntil", unlockUntil)

    lastResetAt = now
}

export async function setNetwork(network: Network) {
    await storage.set("selectedNetwork", network)
}

export async function getNetwork(): Promise<Network> {
    const network = await storage.get<Network>("selectedNetwork")
    return network || Network.Testnet
}

// Pending transactions management
export async function addPendingTransaction(network: Network, address: string, tx: any) {
    const key = `${network}-${address}-pending-txs`
    const existing = await storage.get<{[hash: string]: any}>(key) || {}
    existing[tx.hash] = tx
    await storage.set(key, existing)
}

export async function getPendingTransactions(network: Network, address: string): Promise<any[]> {
    const key = `${network}-${address}-pending-txs`
    const pending = await storage.get<{[hash: string]: any}>(key) || {}
    return Object.values(pending)
}

export async function removePendingTransaction(network: Network, address: string, hash: string) {
    const key = `${network}-${address}-pending-txs`
    const existing = await storage.get<{[hash: string]: any}>(key) || {}
    delete existing[hash]
    await storage.set(key, existing)
}
