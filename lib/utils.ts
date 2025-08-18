import type { Account } from "~types/types";
import { Network } from "~types/types";


export const mnemonicToAccount = (network: Network, mnemonic: string, index: number = 0): Account => {
    const client = new window.vfx.VfxClient(network)

    const privateKey = client.privateKeyFromMneumonic(mnemonic, 0)
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
    const client = new window.vfx.VfxClient(network)
    
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