// Key export (window.verifiedX.requestKey) is limited to the VerifiedX web
// wallet. Every other site uses the signing methods (see lib/provider/).
//
// Origins match exactly: scheme and host, no subdomains, no other ports.
// Each origin receives keys for one network only.

import { Network } from "~types/types"

export const FIRST_PARTY_KEY_SHARE_ORIGINS: Readonly<Record<string, Network>> = Object.freeze({
    "https://wallet.verifiedx.io": Network.Mainnet,
    "https://wallet-testnet.verifiedx.io": Network.Testnet
})

export interface KeyShareCheck {
    ok: boolean
    network?: Network
    error?: string
}

// `origin` must come from the browser (sender.origin), never from the page.
export function checkKeyShareOrigin(origin: string, activeNetwork: Network): KeyShareCheck {
    if (!Object.prototype.hasOwnProperty.call(FIRST_PARTY_KEY_SHARE_ORIGINS, origin)) {
        return { ok: false, error: "Key sharing is only available to the VerifiedX web wallet. Use connect() and the signing methods instead." }
    }
    const network = FIRST_PARTY_KEY_SHARE_ORIGINS[origin]
    if (network !== activeNetwork) {
        return { ok: false, error: `This site uses ${network}, but the extension is on ${activeNetwork}. Switch networks in the extension and try again.` }
    }
    return { ok: true, network }
}
