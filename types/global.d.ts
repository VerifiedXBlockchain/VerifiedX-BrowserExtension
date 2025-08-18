import type { PaginatedResponse, Transaction, VfxAddress } from './types';
export { }

interface IVfxClient {
    new(network: "mainnet" | "testnet", dryRun: boolean = false): {
        // Keypairs
        generatePrivateKey: () => string
        generateMnemonic: (words: 12 | 24) => string
        privateKeyFromMneumonic: (mnemonic: string, index: number) => string
        publicFromPrivate: (privateKey: string) => string
        addressFromPrivate: (privateKey: string) => string
        getSignature: (message: string, privateKey: string) => string

        // Explorer API
        getAddressDetails: (address: string) => Promise<VfxAddress | null>
        domainAvailable: (domain: string) => Promise<boolean>
        lookupDomain: (domain: string) => Promise<string | null>
        listTransactionsForAddress: (address: string, page: number = 1, limit: number = 10) => Promise<PaginatedResponse<Transaction> | null>

        // Transactions
        sendCoin: (keypair: Keypair, toAddress: string, amount: number) => Promise<string | null>
        buyVfxDomain: (keypair: Keypair, domain: string) => Promise<string | null>
    }
}

declare global {
    interface Window {
        vfx: {
            VfxClient: IVfxClient
        }
    }
}
