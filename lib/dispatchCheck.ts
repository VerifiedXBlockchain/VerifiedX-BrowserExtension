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
//
// The transaction's timestamp comes from the node, not this machine, so the
// deadline is measured from a node timestamp read after the failure (always
// at or after the transaction's own) and compared with block times. The
// local clock is never used for the decision.

import { Network } from "~types/types"

const SPYGLASS_API = {
    [Network.Mainnet]: "https://data.verifiedx.io/api",
    [Network.Testnet]: "https://data-testnet.verifiedx.io/api"
}

// Node-side maximum transaction age (Globals.MaxTxAgeSeconds in Core).
export const TX_MAX_AGE_MS = 60 * 60 * 1000
// Covers the node's future-skew allowance (120s) plus clock difference
// between the node that stamped the transaction and the block's validator.
export const TX_EXPIRY_MARGIN_MS = 5 * 60 * 1000

export type DispatchOutcome = "landed" | "never-landed" | "unknown"

export interface UncertainSend {
    hash: string
    network: Network
    fromAddress: string
    toAddress: string
    amount: number
    label: string
    // Local time the failure was recorded; display only.
    recordedAt: number
    // Node time (ms) read after the failure, so it is no earlier than the
    // transaction's own timestamp. Expiry is measured from here. Filled in
    // by the first check that can reach the node.
    chainTimeBasis?: number
    paymentLink?: {
        linkId: string
        shortUrl: string
        fullUrl: string
        escrowAddress: string
    }
}

export function uncertainSendExpiresAt(basis: number): number {
    return basis + TX_MAX_AGE_MS + TX_EXPIRY_MARGIN_MS
}

export function explorerTxUrl(network: Network, hash: string): string {
    return `https://spyglass${network === Network.Testnet ? "-testnet" : ""}.verifiedx.io/transaction/${hash}`
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface DispatchCheck {
    outcome: DispatchOutcome
    // Set when this check read the node time for a send that had none.
    chainTimeBasis?: number
}

export async function checkDispatchOutcome(
    send: Pick<UncertainSend, "network" | "hash" | "chainTimeBasis">,
    fetchFn: FetchFn = (input, init) => fetch(input, init)
): Promise<DispatchCheck> {
    const base = SPYGLASS_API[send.network]

    try {
        const txResponse = await fetchFn(`${base}/transaction/${encodeURIComponent(send.hash)}/`, { cache: "no-store" })
        if (txResponse.ok) {
            return { outcome: "landed" }
        }
        if (txResponse.status !== 404) {
            return { outcome: "unknown" }
        }

        let basis = send.chainTimeBasis
        let newBasis: number | undefined
        if (basis === undefined) {
            const timeResponse = await fetchFn(`${base}/raw/timestamp/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
                cache: "no-store"
            })
            const seconds = timeResponse.ok ? Number((await timeResponse.text()).trim()) : NaN
            if (!Number.isFinite(seconds) || seconds <= 0) {
                return { outcome: "unknown" }
            }
            basis = newBasis = seconds * 1000
        }

        const blocksResponse = await fetchFn(`${base}/blocks/?limit=1`, { cache: "no-store" })
        if (!blocksResponse.ok) {
            return { outcome: "unknown", chainTimeBasis: newBasis }
        }
        const blocks: { results?: Array<{ date_crafted?: string }> } = await blocksResponse.json()
        const latestCrafted = Date.parse(blocks?.results?.[0]?.date_crafted ?? "")
        if (Number.isNaN(latestCrafted)) {
            return { outcome: "unknown", chainTimeBasis: newBasis }
        }

        return {
            outcome: latestCrafted > uncertainSendExpiresAt(basis) ? "never-landed" : "unknown",
            chainTimeBasis: newBasis
        }
    } catch (err) {
        console.error("Failed to check transaction status:", err)
        return { outcome: "unknown" }
    }
}
