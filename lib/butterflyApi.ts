// Butterfly Payment Link API Service

import { Network } from "~types/types"

const API_BASE_URL = 'https://api.befree.io'

export interface CreatePaymentLinkRequest {
    is_testnet: boolean
    amount: string
    asset_type: string
    token_symbol: string
    chain: string
    icon?: string
    message?: string
}

export interface CreatePaymentLinkResponse {
    link_id: string
    uuid: string
    short_url: string
    full_url: string
    status: string
    escrow_address: string
    raw_transaction: {
        to_address: string
        amount: string
        chain: string
        token_symbol: string
    }
    // Total the sender pays: claim_amount + fee_amount
    amount: string
    claim_amount: string
    fee_amount: string
    token_symbol: string
    chain: string
}

export interface PaymentLinkStatus {
    uuid: string
    link_id: string
    status: 'pending' | 'ready_for_redemption' | 'treasury_allocated' | 'awaiting_signature' | 'claiming' | 'claimed' | 'cancelled' | 'failed'
    amount: string
    claim_amount: string
    asset_type: string
    chain: string
    token_symbol: string
    escrow_address: string
    short_url: string
    full_url: string
    usd_value: string
    created_at: string
    icon: string
    message: string
}

export const PAYMENT_LINK_ICONS = [
    'default',
    'gift',
    'money',
    'heart',
    'party',
    'rocket',
    'star'
] as const

export type PaymentLinkIcon = typeof PAYMENT_LINK_ICONS[number]

export async function createPaymentLink(
    network: Network,
    amount: string,
    message?: string,
    icon: PaymentLinkIcon = 'default'
): Promise<CreatePaymentLinkResponse> {
    const body: CreatePaymentLinkRequest = {
        is_testnet: network === Network.Testnet,
        amount,
        asset_type: 'vfx',
        token_symbol: 'VFX',
        chain: 'vfx',
        icon,
        message: message || 'Payment from VFX Wallet'
    }

    const url = `${API_BASE_URL}/api/butterfly/create/`
    console.log('[ButterflyAPI] POST', url, body)

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })

    console.log('[ButterflyAPI] Response status:', response.status)

    if (!response.ok) {
        const errorText = await response.text()
        console.error('[ButterflyAPI] Error:', errorText)
        throw new Error(`Failed to create payment link: ${errorText}`)
    }

    const data = await response.json()
    console.log('[ButterflyAPI] Response data:', data)
    return data
}

export async function getPaymentLinkStatus(
    linkId: string
): Promise<PaymentLinkStatus> {
    const response = await fetch(`${API_BASE_URL}/api/butterfly/status/${linkId}/`)

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get payment link status: ${errorText}`)
    }

    return response.json()
}

const FUNDED_STATUSES: PaymentLinkStatus['status'][] = ['ready_for_redemption', 'treasury_allocated', 'claiming', 'claimed']

export async function pollForFunding(
    linkId: string,
    onStatusUpdate?: (status: PaymentLinkStatus) => void,
    maxAttempts: number = 60,
    intervalMs: number = 5000
): Promise<PaymentLinkStatus> {
    let attempts = 0

    while (attempts < maxAttempts) {
        const status = await getPaymentLinkStatus(linkId)

        if (onStatusUpdate) {
            onStatusUpdate(status)
        }

        // short_url is assigned when the link is created, so it says nothing
        // about funding; the status leaves 'pending' once the deposit is seen.
        if (status.status === 'cancelled' || status.status === 'failed') {
            throw new Error(`Payment link is ${status.status}`)
        }
        if (FUNDED_STATUSES.includes(status.status)) {
            return status
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs))
        attempts++
    }

    throw new Error('Timeout waiting for payment link to be funded')
}
