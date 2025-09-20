// Import VFX types from the official npm package
export type { Keypair, VfxAddress, Transaction, PaginatedResponse } from 'vfx-web-sdk'

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

// BTC


export interface IBtcKeypair {
    address: string | undefined;
    addresses: IBtcAddresses;
    wif: string;
    privateKey: string | undefined;
    publicKey: string;
    mnemonic?: string;
}

export interface IBtcAddresses {
    p2pkh: string | undefined;    // Legacy (P2PKH)
    p2sh: string | undefined;     // Nested Segwit (P2SH-P2WPKH)
    bech32: string | undefined;   // Native Segwit (P2WPKH)
    bech32m: string | undefined;  // Taproot (P2TR)
}

export interface IAccountInfo {
    totalRecieved: number;
    totalSent: number;
    balance: number;
    txCount: number;
}

export interface ITransaction {
    txid: string;
    version: number;
    locktime: number;
    vin: ITransactionInput[];
    vout: ITransactionOutput[];
    size: number;
    weight: number;
    fee: number;
    status: ITransactionStatus;
}

export interface ITransactionInput {
    txid: string;
    vout: number;
    prevout: ITransactionOutput;
    scriptsig: string;
    scriptsig_asm: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
}

export interface ITransactionOutput {
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
}

export interface ITransactionStatus {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
}

export interface ICreateTxResponse {
    success: boolean;
    result: string | null;
    error: string | null;
}

export interface IBroadcastTxResponse {
    success: boolean;
    result: string | null;
    error: string | null;
}

export interface IFeeRates {
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
    economyFee: number;
    minimumFee: number;
}

export interface IUTXO {
    txid: string;
    vout: number;
    status: ITransactionStatus;
    value: number;
}
