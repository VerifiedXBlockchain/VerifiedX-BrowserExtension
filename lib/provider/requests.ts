// Pending provider requests, held by the background while an approval popup
// is open.
//
// Each request gets an id generated here (never chosen by the page), the
// origin the browser reported for the sending tab, and one approval window.
// A site has at most one request waiting at a time; a request that is not
// answered within REQUEST_TTL_MS, or whose window is closed, is rejected.

import { ProviderError, ProviderErrorCode, type ProviderErrorPayload, type ProviderResponse } from "~lib/provider/protocol"

export const REQUEST_TTL_MS = 5 * 60 * 1000

export interface PendingProviderRequest {
    id: string
    origin: string
    method: string
    // Validated parameters; safe to show in the popup.
    params: unknown
    timestamp: number
    tabId: number
    windowId?: number
    resolve: (response: ProviderResponse) => void
}

// What the popup is allowed to see about a request.
export interface ProviderRequestView {
    id: string
    origin: string
    method: string
    params: unknown
    timestamp: number
}

export class ProviderRequestQueue {
    private requests = new Map<string, PendingProviderRequest>()

    constructor(
        private readonly now: () => number = () => Date.now(),
        private readonly newId: () => string = () => crypto.randomUUID()
    ) {}

    // Registers a request and returns it with a promise that settles when the
    // popup answers, the window closes, or the request expires.
    add(input: { origin: string; method: string; params: unknown; tabId: number }): {
        request: PendingProviderRequest
        response: Promise<ProviderResponse>
    } {
        if (this.liveForOrigin(input.origin)) {
            throw new ProviderError(ProviderErrorCode.RequestPending, "A request from this site is already waiting for approval")
        }
        let resolve!: (response: ProviderResponse) => void
        const response = new Promise<ProviderResponse>((r) => (resolve = r))
        const request: PendingProviderRequest = { ...input, id: this.newId(), timestamp: this.now(), resolve }
        this.requests.set(request.id, request)
        return { request, response }
    }

    // The request, if it exists and has not expired. Expired requests are
    // rejected as a side effect.
    get(requestId: unknown): PendingProviderRequest | null {
        if (typeof requestId !== "string") return null
        const request = this.requests.get(requestId)
        if (!request) return null
        if (this.now() - request.timestamp > REQUEST_TTL_MS) {
            this.reject(request, { code: ProviderErrorCode.RequestExpired, message: "Request expired" })
            return null
        }
        return request
    }

    view(requestId: unknown): ProviderRequestView | null {
        const request = this.get(requestId)
        if (!request) return null
        const { id, origin, method, params, timestamp } = request
        return { id, origin, method, params, timestamp }
    }

    liveForOrigin(origin: string): PendingProviderRequest | null {
        for (const request of this.requests.values()) {
            if (request.origin === origin && this.get(request.id)) return request
        }
        return null
    }

    setWindow(requestId: string, windowId: number) {
        const request = this.requests.get(requestId)
        if (request) request.windowId = windowId
    }

    resolve(request: PendingProviderRequest, result: unknown) {
        this.settle(request, { ok: true, result })
    }

    reject(request: PendingProviderRequest, error: ProviderErrorPayload) {
        this.settle(request, { ok: false, error })
    }

    // Closing an approval window without answering rejects its request.
    windowClosed(windowId: number) {
        for (const request of [...this.requests.values()]) {
            if (request.windowId === windowId) {
                this.reject(request, { code: ProviderErrorCode.UserRejected, message: "User rejected the request" })
            }
        }
    }

    sweep() {
        for (const request of [...this.requests.values()]) this.get(request.id)
    }

    private settle(request: PendingProviderRequest, response: ProviderResponse) {
        if (this.requests.get(request.id) !== request) return
        this.requests.delete(request.id)
        request.resolve(response)
    }
}
