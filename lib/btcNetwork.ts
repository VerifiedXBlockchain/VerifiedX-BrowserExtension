// Bitcoin endpoints per network.
//
// The VerifiedX testnet runs on a private Bitcoin signet, not testnet4. It
// uses testnet address formats, so the SDK's 'testnet' keys and addresses
// still apply; only the API and explorer differ. No public server carries
// this chain, and there is no public faucet.
import { btc } from "vfx-web-sdk"

import { Network } from "~types/types"

const BTC_API_BASE_URLS: Record<Network, string> = {
    [Network.Mainnet]: "https://mempool.space/api",
    [Network.Testnet]: "https://signet.verifiedx.io/api"
}

const BTC_EXPLORER_URLS: Record<Network, string> = {
    [Network.Mainnet]: "https://mempool.space",
    [Network.Testnet]: "https://signet.verifiedx.io"
}

export const BTC_NETWORK_LABELS: Record<Network, string> = {
    [Network.Mainnet]: "Bitcoin Mainnet",
    [Network.Testnet]: "VerifiedX Bitcoin Signet"
}

export function btcApiBaseUrl(network: Network): string {
    return BTC_API_BASE_URLS[network]
}

export function btcTxUrl(network: Network, txid: string): string {
    return `${BTC_EXPLORER_URLS[network]}/tx/${txid}`
}

export function createBtcClient(network: Network): btc.BtcClient {
    return new btc.BtcClient(network === Network.Mainnet ? "mainnet" : "testnet", {
        apiBaseUrl: btcApiBaseUrl(network)
    })
}
