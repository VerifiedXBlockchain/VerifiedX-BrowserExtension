// Price API Service for VFX/USD conversion

import { Network } from "~types/types"

let cachedPrice: { price: number; timestamp: number } | null = null
const CACHE_DURATION = 60000 // 1 minute cache

const PRICE_API_URLS = {
    [Network.Mainnet]: 'https://data.verifiedx.io/api/cmc-price/vfx/',
    [Network.Testnet]: 'https://data-testnet.verifiedx.io/api/cmc-price/vfx/'
}

export async function getVfxPrice(network: Network = Network.Mainnet): Promise<number | null> {
    // Return cached price if still valid
    if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_DURATION) {
        return cachedPrice.price
    }

    try {
        const response = await fetch(PRICE_API_URLS[network], {
            headers: { 'Accept': 'application/json' }
        })

        if (response.ok) {
            const data = await response.json()
            if (data.success && data.data?.usdt_price) {
                const price = data.data.usdt_price
                cachedPrice = { price, timestamp: Date.now() }
                return price
            }
        }

        return null
    } catch (err) {
        console.error('Failed to fetch VFX price:', err)
        return null
    }
}

export function formatUsd(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount)
}
