import type { Account, IBtcKeypair } from "~types/types";
import { Network } from "~types/types";


import { VfxClient, btc } from 'vfx-web-sdk'

// Normalize VFX private keys by stripping 00 prefix if present (for CLI compatibility)
export const normalizeVfxPrivateKey = (privateKey: string): string => {
    if (privateKey.length === 66 && privateKey.startsWith('00')) {
        return privateKey.substring(2)
    }
    return privateKey
}

export const mnemonicToAccount = (network: Network, mnemonic: string, index: number = 0): Account => {
    const client = new VfxClient(network)

    const rawPrivateKey = client.privateKeyFromMneumonic(mnemonic, 0)
    const privateKey = normalizeVfxPrivateKey(rawPrivateKey)
    const publicKey = client.publicFromPrivate(privateKey)
    const address = client.addressFromPrivate(privateKey)

    const account: Account = {
        private: privateKey,
        public: publicKey,
        address: address
    }

    return account;
}

export const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch((err) => {
        console.error("Failed to copy:", err)
    })
}

export const validateVfxAddress = (address: string, network: Network): boolean => {
    if (!address) return false;

    if (address.length !== 34) {
        return false;
    }

    if (address.startsWith("xRBX")) {
        return true;
    }

    if (address.startsWith(network == Network.Testnet ? "x" : "R")) {
        return true;
    }

    return false;

}

export const validateDomain = (input: string): boolean => {
    return /^[a-zA-Z0-9-]+$/.test(input);
}

export const privateKeyToAccount = (network: Network, privateKey: string): Account => {
    const client = new VfxClient(network)

    const publicKey = client.publicFromPrivate(privateKey)
    const address = client.addressFromPrivate(privateKey)

    const account: Account = {
        private: privateKey,
        public: publicKey,
        address: address
    }

    return account;
}

export const validatePrivateKey = (privateKey: string): boolean => {
    if (!privateKey) return false;

    // Remove any whitespace
    const cleanKey = privateKey.trim();

    // Check if it's a valid hex string of expected length
    // VFX private keys are typically 64 hex characters (32 bytes)
    const hexPattern = /^[a-fA-F0-9]{64}$/;
    return hexPattern.test(cleanKey);
}

export const validateMnemonic = (words: string[]): boolean => {
    // Check if we have exactly 12 or 24 words
    if (words.length !== 12 && words.length !== 24) {
        return false;
    }

    // Check that all words are non-empty and contain only letters
    return words.every(word => {
        const trimmed = word.trim().toLowerCase();
        return trimmed.length > 0 && /^[a-z]+$/.test(trimmed);
    });
}

export const normalizeMnemonic = (input: string): string[] => {
    // Split by various separators and filter out empty strings
    return input
        .trim()
        .split(/[\s,\n\t]+/)
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length > 0);
}

export const createAccountFromSecret = (network: Network, privateKey: string): Account => {
    // Now we always store private keys, so this is simplified
    const normalizedPrivateKey = normalizeVfxPrivateKey(privateKey)
    return privateKeyToAccount(network, normalizedPrivateKey);
}

// BTC utility function using existing BTC client
export const createBtcKeypairFromVfx = (network: Network, vfxPrivateKey: string): IBtcKeypair => {
    // Normalize VFX private key (strip 00 prefix if present)
    const normalizedKey = normalizeVfxPrivateKey(vfxPrivateKey)

    // Convert VFX private key to email/password format (matches web wallet)
    const email = `${normalizedKey.substring(0, 8)}@${normalizedKey.substring(normalizedKey.length - 8)}.com`
    const password = `${normalizedKey.substring(0, 12)}${normalizedKey.substring(normalizedKey.length - 12)}`

    // Use BtcClient convenience method
    const btcNetwork = network === Network.Mainnet ? 'mainnet' : 'testnet'
    console.log("VFX Network:", network, "-> BTC Network:", btcNetwork)
    const btcClient = new btc.BtcClient(btcNetwork)
    return btcClient.generateEmailKeypair(email, password, 0)
}