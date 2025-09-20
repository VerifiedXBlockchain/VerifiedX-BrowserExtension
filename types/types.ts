// Import types from the unified vfx-web-sdk package (VFX + BTC)
export type { Keypair, VfxAddress, Transaction, PaginatedResponse } from 'vfx-web-sdk'

// Import BTC types from the btc namespace
import type { btc } from 'vfx-web-sdk'
export type IBtcKeypair = btc.IBtcKeypair
export type IBtcAddresses = btc.IBtcAddresses
export type IAccountInfo = btc.IAccountInfo
export type ITransaction = btc.ITransaction
export type ICreateTxResponse = btc.ICreateTxResponse
export type IBroadcastTxResponse = btc.IBroadcastTxResponse
export type IFeeRates = btc.IFeeRates

// Network enum - defined locally to avoid runtime issues, matches vfx-web-sdk values
export enum Network {
    Mainnet = 'mainnet',
    Testnet = 'testnet',
}

// Currency enum is specific to our extension (VFX + BTC support)
export enum Currency {
    VFX = 'vfx',
    BTC = 'btc',
}

// Account interface is our custom wrapper around VFX keypairs
export interface Account {
    private: string;
    public: string;
    address: string;
}

// Note: BTC types are now imported from vfx-web-sdk/btc namespace above
// Keeping only extension-specific interfaces that aren't in the SDK

export interface IUTXO {
    txid: string;
    vout: number;
    status: ITransactionStatus;
    value: number;
}

// Re-export some types with local names for backward compatibility
export type ITransactionInput = btc.ITransaction['vin'][0]
export type ITransactionOutput = btc.ITransaction['vout'][0]
export type ITransactionStatus = btc.ITransaction['status']
