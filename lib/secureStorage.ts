import { Storage } from "@plasmohq/storage"


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


export async function encryptMnemonic(mnemonic: string, password: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(password, salt)

    const cipherText = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encode(mnemonic)
    )

    const encryptedData = {
        salt: Array.from(salt),
        iv: Array.from(iv),
        cipherText: Array.from(new Uint8Array(cipherText)),
    }

    await storage.set("wallet", encryptedData)
}

export async function decryptMnemonic(password: string): Promise<string> {
    const result = await storage.get("wallet")

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

export async function isWalletCreated(): Promise<boolean> {
    const result = await storage.get("wallet")
    return !!result
}

export async function clearWallet() {
    await storage.remove("wallet")
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
