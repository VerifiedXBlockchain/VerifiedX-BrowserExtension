import { describe, expect, it } from "vitest"

import { checkDispatchOutcome, uncertainSendExpiresAt } from "~lib/dispatchCheck"
import { Network } from "~types/types"

const HASH = "abc123"
const NODE_TIME_S = Date.parse("2026-10-08T12:00:00Z") / 1000
const BASIS = NODE_TIME_S * 1000

type Route = { status: number; body?: unknown; text?: string } | Error

function fakeFetch(routes: Record<string, Route>) {
    const calls: Array<{ url: string; method: string }> = []
    const fn = async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? "GET" })
        const path = Object.keys(routes).find((p) => url.includes(p))
        const route = path ? routes[path] : { status: 500 }
        if (route instanceof Error) throw route
        return new Response(route.text ?? JSON.stringify(route.body ?? {}), { status: route.status })
    }
    return { fn, calls }
}

function latestBlockAt(iso: string): Route {
    return { status: 200, body: { results: [{ height: 1, date_crafted: iso }] } }
}

const NOT_FOUND = { [`/transaction/${HASH}/`]: { status: 404 } }
const NODE_TIME = { "/raw/timestamp/": { status: 200, text: String(NODE_TIME_S) } }

describe("checkDispatchOutcome", () => {
    it("reports landed when the explorer has the transaction", async () => {
        const { fn, calls } = fakeFetch({ [`/transaction/${HASH}/`]: { status: 200, body: { hash: HASH } } })
        const result = await checkDispatchOutcome({ network: Network.Testnet, hash: HASH }, fn)
        expect(result.outcome).toBe("landed")
        expect(calls[0].url).toBe(`https://data-testnet.verifiedx.io/api/transaction/${HASH}/`)
    })

    it("reads the node time once and returns it as the expiry basis", async () => {
        const { fn, calls } = fakeFetch({ ...NOT_FOUND, ...NODE_TIME, "/blocks/": latestBlockAt("2026-10-08T12:00:10Z") })
        const result = await checkDispatchOutcome({ network: Network.Mainnet, hash: HASH }, fn)
        expect(result).toEqual({ outcome: "unknown", chainTimeBasis: BASIS })
        expect(calls.find((c) => c.url.endsWith("/raw/timestamp/"))?.method).toBe("POST")
    })

    it("does not read the node time again once it has a basis", async () => {
        const { fn, calls } = fakeFetch({ ...NOT_FOUND, "/blocks/": latestBlockAt("2026-10-08T12:30:00Z") })
        const result = await checkDispatchOutcome({ network: Network.Mainnet, hash: HASH, chainTimeBasis: BASIS }, fn)
        expect(result).toEqual({ outcome: "unknown", chainTimeBasis: undefined })
        expect(calls.some((c) => c.url.includes("/raw/timestamp/"))).toBe(false)
    })

    it("stays unknown when the node time cannot be read", async () => {
        const after = new Date(uncertainSendExpiresAt(BASIS) + 60_000).toISOString()
        for (const timeRoute of [{ status: 502 }, { status: 200, text: "not a number" }, new TypeError("offline")]) {
            const { fn } = fakeFetch({ ...NOT_FOUND, "/raw/timestamp/": timeRoute, "/blocks/": latestBlockAt(after) })
            expect((await checkDispatchOutcome({ network: Network.Mainnet, hash: HASH }, fn)).outcome).toBe("unknown")
        }
    })

    it("stays unknown just inside the expiry margin", async () => {
        const justBefore = new Date(uncertainSendExpiresAt(BASIS) - 1000).toISOString()
        const { fn } = fakeFetch({ ...NOT_FOUND, "/blocks/": latestBlockAt(justBefore) })
        const result = await checkDispatchOutcome({ network: Network.Mainnet, hash: HASH, chainTimeBasis: BASIS }, fn)
        expect(result.outcome).toBe("unknown")
    })

    it("reports never-landed once a block past the expiry is indexed without it", async () => {
        const after = new Date(uncertainSendExpiresAt(BASIS) + 1000).toISOString()
        const { fn } = fakeFetch({ ...NOT_FOUND, "/blocks/": latestBlockAt(after) })
        const result = await checkDispatchOutcome({ network: Network.Mainnet, hash: HASH, chainTimeBasis: BASIS }, fn)
        expect(result.outcome).toBe("never-landed")
    })

    it("never concludes never-landed from an explorer error", async () => {
        const after = new Date(uncertainSendExpiresAt(BASIS) + 1000).toISOString()
        for (const txRoute of [{ status: 500 }, { status: 502 }, new TypeError("Failed to fetch")]) {
            const { fn } = fakeFetch({ [`/transaction/${HASH}/`]: txRoute, "/blocks/": latestBlockAt(after) })
            const result = await checkDispatchOutcome({ network: Network.Mainnet, hash: HASH, chainTimeBasis: BASIS }, fn)
            expect(result.outcome).toBe("unknown")
        }
    })

    it("stays unknown when the latest block cannot be read", async () => {
        for (const blocks of [{ status: 503 }, { status: 200, body: { results: [] } }, new TypeError("offline")]) {
            const { fn } = fakeFetch({ ...NOT_FOUND, "/blocks/": blocks })
            const result = await checkDispatchOutcome({ network: Network.Mainnet, hash: HASH, chainTimeBasis: BASIS }, fn)
            expect(result.outcome).toBe("unknown")
        }
    })
})
