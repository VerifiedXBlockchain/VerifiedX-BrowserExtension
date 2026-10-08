// Resolves a send whose dispatch outcome is unknown.
//
// When the node's response to a broadcast is lost, the SDK throws
// TransactionDispatchError carrying the hash: the transaction may or may not
// have been accepted. Sending again before that is settled can pay twice,
// because once the first transaction confirms, the retry gets the next nonce
// and is a separate payment.
//
// A transaction is settled when the explorer has it in a block, or when the
// explorer has indexed a block crafted after the transaction stopped being
// includable. The node rejects transactions older than MaxTxAgeSeconds
// (3600s), so a hash still missing from blocks past that point never landed.

import { Network } from "~types/types"

const SPYGLASS_API = {
    [Network.Mainnet]: "https://data.verifiedx.io/api",
    [Network.Testnet]: "https://data-testnet.verifiedx.io/api"
}

// Node-side maximum transaction age (Globals.MaxTxAgeSeconds in Core).
export const TX_MAX_AGE_MS = 60 * 60 * 1000
// Covers the node's future-skew allowance (120s) plus clock difference
// between this machine and the validator that crafts the block.
export const TX_EXPIRY_MARGIN_MS = 5 * 60 * 1000

export type DispatchOutcome = "landed" | "never-landed" | "unknown"

export interface UncertainSend {
    hash: string
    network: Network
    fromAddress: string
    toAddress: string
    amount: number
    label: string
    // Taken after the dispatch failed, so it is no earlier than the
    // transaction's own timestamp. Expiry is measured from here.
    recordedAt: number
    paymentLink?: {
        linkId: string
        shortUrl: string
        fullUrl: string
        escrowAddress: string
    }
}

export function uncertainSendExpiresAt(recordedAt: number): number {
    return recordedAt + TX_MAX_AGE_MS + TX_EXPIRY_MARGIN_MS
}

export function explorerTxUrl(network: Network, hash: string): string {
    return `https://spyglass${network === Network.Testnet ? "-testnet" : ""}.verifiedx.io/transaction/${hash}`
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export async function checkDispatchOutcome(
    network: Network,
    hash: string,
    recordedAt: number,
    fetchFn: FetchFn = (input, init) => fetch(input, init)
): Promise<DispatchOutcome> {
    const base = SPYGLASS_API[network]

    try {
        const txResponse = await fetchFn(`${base}/transaction/${encodeURIComponent(hash)}/`, { cache: "no-store" })
        if (txResponse.ok) {
            return "landed"
        }
        if (txResponse.status !== 404) {
            return "unknown"
        }

        const blocksResponse = await fetchFn(`${base}/blocks/?limit=1`, { cache: "no-store" })
        if (!blocksResponse.ok) {
            return "unknown"
        }
        const blocks: { results?: Array<{ date_crafted?: string }> } = await blocksResponse.json()
        const latestCrafted = Date.parse(blocks?.results?.[0]?.date_crafted ?? "")
        if (Number.isNaN(latestCrafted)) {
            return "unknown"
        }

        return latestCrafted > uncertainSendExpiresAt(recordedAt) ? "never-landed" : "unknown"
    } catch (err) {
        console.error("Failed to check transaction status:", err)
        return "unknown"
    }
}
