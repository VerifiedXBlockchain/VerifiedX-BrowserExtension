// Checks the payment-link server's reply before the wallet signs anything.
//
// The server chooses the escrow address and adds its fee, so the amount and
// destination that get signed come from its reply. They are checked here and
// shown in full on the confirm screen; the wallet signs exactly the total the
// user approved there.

import { formatUnits, parseAmount } from "~lib/amount"
import type { CreatePaymentLinkResponse } from "~lib/butterflyApi"
import { validateVfxAddress } from "~lib/utils"
import type { Network } from "~types/types"

export interface PaymentLinkQuote {
    ok: boolean
    error?: string
    escrowAddress?: string
    claimUnits?: bigint
    feeUnits?: bigint
    totalUnits?: bigint
    // Exact amounts as strings, for display and for signing.
    claim?: string
    fee?: string
    total?: string
}

function refuse(error: string): PaymentLinkQuote {
    return { ok: false, error }
}

export function verifyPaymentLinkQuote(
    response: CreatePaymentLinkResponse,
    requestedUnits: bigint,
    network: Network,
    balanceUnits: bigint
): PaymentLinkQuote {
    if (response.chain !== "vfx" || response.token_symbol !== "VFX") {
        return refuse(`Server returned a ${response.token_symbol} link on ${response.chain}, not VFX`)
    }

    const escrowAddress = response.escrow_address
    if (!validateVfxAddress(escrowAddress, network)) {
        return refuse("Server returned an invalid escrow address")
    }

    const claim = parseAmount(String(response.claim_amount ?? ""))
    const fee = parseAmount(String(response.fee_amount ?? ""))
    const total = parseAmount(String(response.amount ?? ""))
    if (!claim.ok || !total.ok) {
        return refuse("Server returned an amount the wallet cannot read")
    }
    // A zero fee is valid; parseAmount rejects zero, so read it separately.
    const feeUnits = fee.ok ? fee.units : /^0*(\.0*)?$/.test(String(response.fee_amount ?? "").trim()) ? 0n : null
    if (feeUnits === null) {
        return refuse("Server returned a fee the wallet cannot read")
    }

    if (claim.units !== requestedUnits) {
        return refuse(
            `Server's link amount (${claim.display} VFX) does not match the amount you entered (${formatUnits(requestedUnits)} VFX)`
        )
    }
    if (total.units !== claim.units + feeUnits) {
        return refuse(`Server's total (${total.display} VFX) is not the link amount plus the fee`)
    }

    const raw = response.raw_transaction
    if (raw) {
        const rawAmount = parseAmount(String(raw.amount ?? ""))
        if (raw.to_address !== escrowAddress || !rawAmount.ok || rawAmount.units !== total.units) {
            return refuse("Server's transaction details do not match the link")
        }
    }

    if (total.units > balanceUnits) {
        return refuse(`Insufficient balance for ${total.display} VFX`)
    }

    return {
        ok: true,
        escrowAddress,
        claimUnits: claim.units,
        feeUnits,
        totalUnits: total.units,
        claim: claim.display,
        fee: formatUnits(feeUnits),
        total: total.display
    }
}
