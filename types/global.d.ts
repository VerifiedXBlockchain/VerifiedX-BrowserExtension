// Import VFX types from the npm package
import type { PaginatedResponse, Transaction, VfxAddress, Keypair, VfxClient } from 'vfx-web-sdk'
export { }

// BTC client interface - still needed since we use window.btc
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
            VfxClient: VfxClient
        }
        btc: {
            BtcClient: IBtcClient
        }
    }
}
