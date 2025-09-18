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

interface IBtcClient {
    new(network: "mainnet" | "testnet", dryRun?: boolean): {
        // Keypair generation and management
        generatePrivateKey: () => IBtcKeypair
        generateMnemonic: (words?: 12 | 24) => IBtcKeypair
        privateKeyFromMnemonic: (mnemonic: string, index?: number) => IBtcKeypair
        publicFromPrivate: (privateKey: string) => IBtcKeypair
        addressFromPrivate: (privateKey: string) => IBtcKeypair
        addressFromWif: (wif: string) => IBtcKeypair
        getSignature: (message: string, privateKey: string) => string
        getSignatureFromWif: (message: string, wif: string) => string

        // Account and address info
        getAddressInfo: (address: string, inSatoshis?: boolean) => Promise<IAccountInfo>
        getTransactions: (address: string, limit?: number, before?: number | null) => Promise<ITransaction[]>

        // Transaction operations
        getFeeRates: () => Promise<IFeeRates | null>
        createTransaction: (senderWif: string, recipientAddress: string, amount: number, feeRate?: number) => Promise<ICreateTxResponse>
        broadcastTransaction: (transactionHex: string) => Promise<IBroadcastTxResponse>
        sendBtc: (senderWif: string, recipientAddress: string, amount: number, feeRate?: number) => Promise<string | null>

        // Utility functions
        getRawTransaction: (txId: string) => Promise<Buffer>

        // Additional convenience methods
        generateEmailKeypair: (email: string, password: string, index?: number) => IBtcKeypair
    }
}


declare global {
    interface Window {
        vfx: {
            VfxClient: IVfxClient
        }
        btc: {
            BtcClient: IBtcClient

        }
    }
}
