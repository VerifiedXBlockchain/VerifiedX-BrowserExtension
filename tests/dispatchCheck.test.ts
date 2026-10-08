import { describe, expect, it } from "vitest"

import { checkDispatchOutcome, uncertainSendExpiresAt } from "~lib/dispatchCheck"
import { Network } from "~types/types"

const HASH = "abc123"
const RECORDED_AT = Date.parse("2026-10-08T12:00:00Z")

function fakeFetch(routes: Record<string, { status: number; body?: unknown } | Error>) {
    const calls: string[] = []
    const fn = async (url: string) => {
        calls.push(url)
        const path = Object.keys(routes).find((p) => url.includes(p))
        const route = path ? routes[path] : { status: 500 }
        if (route instanceof Error) throw route
        return new Response(JSON.stringify(route.body ?? {}), { status: route.status })
    }
    return { fn, calls }
}

function latestBlockAt(iso: string) {
    return { status: 200, body: { results: [{ height: 1, date_crafted: iso }] } }
}

describe("checkDispatchOutcome", () => {
    it("reports landed when the explorer has the transaction", async () => {
        const { fn, calls } = fakeFetch({ [`/transaction/${HASH}/`]: { status: 200, body: { hash: HASH } } })
        expect(await checkDispatchOutcome(Network.Testnet, HASH, RECORDED_AT, fn)).toBe("landed")
        expect(calls[0]).toBe(`https://data-testnet.verifiedx.io/api/transaction/${HASH}/`)
    })

    it("stays unknown while the transaction could still be included", async () => {
        const { fn } = fakeFetch({
            [`/transaction/${HASH}/`]: { status: 404 },
            "/blocks/": latestBlockAt("2026-10-08T12:30:00Z")
        })
        expect(await checkDispatchOutcome(Network.Mainnet, HASH, RECORDED_AT, fn)).toBe("unknown")
    })

    it("stays unknown just inside the expiry margin", async () => {
        const justBefore = new Date(uncertainSendExpiresAt(RECORDED_AT) - 1000).toISOString()
        const { fn } = fakeFetch({ [`/transaction/${HASH}/`]: { status: 404 }, "/blocks/": latestBlockAt(justBefore) })
        expect(await checkDispatchOutcome(Network.Mainnet, HASH, RECORDED_AT, fn)).toBe("unknown")
    })

    it("reports never-landed once a block past the expiry is indexed without it", async () => {
        const after = new Date(uncertainSendExpiresAt(RECORDED_AT) + 1000).toISOString()
        const { fn } = fakeFetch({ [`/transaction/${HASH}/`]: { status: 404 }, "/blocks/": latestBlockAt(after) })
        expect(await checkDispatchOutcome(Network.Mainnet, HASH, RECORDED_AT, fn)).toBe("never-landed")
    })

    it("never concludes never-landed from an explorer error", async () => {
        const after = new Date(uncertainSendExpiresAt(RECORDED_AT) + 1000).toISOString()
        for (const txRoute of [{ status: 500 }, { status: 502 }, new TypeError("Failed to fetch")]) {
            const { fn } = fakeFetch({ [`/transaction/${HASH}/`]: txRoute, "/blocks/": latestBlockAt(after) })
            expect(await checkDispatchOutcome(Network.Mainnet, HASH, RECORDED_AT, fn)).toBe("unknown")
        }
    })

    it("stays unknown when the latest block cannot be read", async () => {
        for (const blocks of [{ status: 503 }, { status: 200, body: { results: [] } }, new TypeError("offline")]) {
            const { fn } = fakeFetch({ [`/transaction/${HASH}/`]: { status: 404 }, "/blocks/": blocks })
            expect(await checkDispatchOutcome(Network.Mainnet, HASH, RECORDED_AT, fn)).toBe("unknown")
        }
    })
})
