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

export const validateVfxAddress = (address: string, network: Network) => {
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