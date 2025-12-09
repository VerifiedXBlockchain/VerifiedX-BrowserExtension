// Key encryption utilities for exporting private keys to websites
// Uses PBKDF2 (10,000 iterations) + AES-GCM for faster encryption/decryption

// Helper to encode text as Uint8Array
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

// Number of PBKDF2 iterations for export encryption
const EXPORT_ITERATIONS = 10_000

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
      iterations: EXPORT_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  )
}

/**
 * Encrypt a private key for export to a website.
 * Uses the same format as secureStorage.ts for consistency.
 */
export async function encryptKeyForExport(
  privateKey: string,
  password: string
): Promise<{ salt: number[]; iv: number[]; cipherText: number[] }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)

  const cipherText = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encode(privateKey)
  )

  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    cipherText: Array.from(new Uint8Array(cipherText)),
  }
}
