// Background-side handling of provider requests. Dependencies are passed in
// so the flow can be tested without a browser.

import type { ConnectionStore } from "~lib/provider/connections"
import {
    APPROVAL_METHODS,
    assertNoKeyMaterial,
    buildSignedMessage,
    CONNECTED_METHODS,
    errorPayload,
    ProviderError,
    ProviderErrorCode,
    ProviderMethod,
    sanitizeResult,
    validateSignMessageParams,
    validateTransactionParams,
    type ProviderResponse,
    type SignMessageParams,
    type SignMessageResult,
    type SignTransactionResult,
    type TransactionRequest,
    type VfxAccount
} from "~lib/provider/protocol"
import type { ProviderRequestQueue } from "~lib/provider/requests"
import type { Network } from "~types/types"

export interface ProviderHandlerDeps {
    queue: ProviderRequestQueue
    connections: ConnectionStore
    // The unlocked wallet's private key, or null while locked.
    unlockedKey: () => string | null
    activeNetwork: () => Promise<Network>
    deriveAccount: (network: Network, privateKey: string) => VfxAccount
    // Opens the approval popup for a request; resolves to its window id.
    openApprovalWindow: (requestId: string) => Promise<number>
}

export interface RequestSource {
    // From the browser (sender.origin / sender.url), never from the page.
    origin: string
    tabId: number
}

export type ApprovalOutcome =
    | { outcome: "approved"; result: unknown }
    | { outcome: "rejected" }
    | { outcome: "failed"; message: string }

export class ProviderHandler {
    constructor(private readonly deps: ProviderHandlerDeps) {}

    private async currentAccount(): Promise<VfxAccount | null> {
        const key = this.deps.unlockedKey()
        if (!key) return null
        return this.deps.deriveAccount(await this.deps.activeNetwork(), key)
    }

    async handleRequest(source: RequestSource, method: unknown, params: unknown): Promise<ProviderResponse> {
        try {
            return { ok: true, result: await this.dispatch(source, method, params) }
        } catch (err) {
            return { ok: false, error: errorPayload(err) }
        }
    }

    private async dispatch(source: RequestSource, method: unknown, params: unknown): Promise<unknown> {
        const { connections } = this.deps
        const connected = await connections.isConnected(source.origin)

        switch (method) {
            case ProviderMethod.GetAccounts: {
                const account = connected ? await this.currentAccount() : null
                return account ? [account] : []
            }
            case ProviderMethod.Disconnect:
                await connections.disconnect(source.origin)
                return true
            case ProviderMethod.Connect: {
                const account = connected ? await this.currentAccount() : null
                if (account) return [account]
                return this.awaitApproval(source, ProviderMethod.Connect, {})
            }
        }

        if (typeof method !== "string" || !APPROVAL_METHODS.has(method)) {
            throw new ProviderError(ProviderErrorCode.UnsupportedMethod, `Unsupported method: ${String(method)}`)
        }
        if (CONNECTED_METHODS.has(method) && !connected) {
            throw new ProviderError(ProviderErrorCode.Unauthorized, "Connect this site to the wallet first (vfx_connect)")
        }

        const validated =
            method === ProviderMethod.SignMessage
                ? validateSignMessageParams(params)
                : validateTransactionParams(params, await this.deps.activeNetwork())

        return this.awaitApproval(source, method, validated)
    }

    private async awaitApproval(source: RequestSource, method: string, params: unknown): Promise<unknown> {
        const { queue } = this.deps
        const { request, response } = queue.add({ origin: source.origin, method, params, tabId: source.tabId })
        try {
            queue.setWindow(request.id, await this.deps.openApprovalWindow(request.id))
        } catch {
            queue.reject(request, { code: ProviderErrorCode.Internal, message: "Could not open the approval window" })
        }
        const settled = await response
        if (!settled.ok) throw new ProviderError(settled.error.code, settled.error.message)
        return settled.result
    }

    // Called with the popup's answer. Returns false when the request is gone
    // (expired, answered, or never existed).
    async handleApproval(requestId: unknown, answer: ApprovalOutcome): Promise<boolean> {
        const { queue } = this.deps
        const request = queue.get(requestId)
        if (!request) return false

        if (answer.outcome === "rejected") {
            queue.reject(request, { code: ProviderErrorCode.UserRejected, message: "User rejected the request" })
            return true
        }
        if (answer.outcome === "failed") {
            queue.reject(request, { code: ProviderErrorCode.Internal, message: String(answer.message || "Request failed") })
            return true
        }

        try {
            const account = await this.currentAccount()
            if (!account) {
                throw new ProviderError(ProviderErrorCode.Internal, "Wallet is locked")
            }

            let result: unknown
            if (request.method === ProviderMethod.Connect) {
                // The account comes from the key held here, not from the popup.
                await this.deps.connections.connect(request.origin)
                result = [account]
            } else {
                result = sanitizeResult(request.method, answer.result)
                this.checkResultMatchesRequest(request.method, request.origin, request.params, result, account)
            }

            assertNoKeyMaterial(result, this.deps.unlockedKey())
            queue.resolve(request, result)
        } catch (err) {
            queue.reject(request, errorPayload(err))
        }
        return true
    }

    private checkResultMatchesRequest(method: string, origin: string, params: unknown, result: unknown, account: VfxAccount) {
        const mismatch = () => {
            throw new ProviderError(ProviderErrorCode.Internal, "The result does not match the request")
        }
        if (method === ProviderMethod.SignMessage) {
            const signed = result as SignMessageResult
            const { message } = params as SignMessageParams
            if (
                signed.message !== message ||
                signed.signedMessage !== buildSignedMessage(origin, message) ||
                signed.address !== account.address ||
                signed.publicKey !== account.publicKey
            ) {
                mismatch()
            }
        }
        if (method === ProviderMethod.SignTransaction) {
            const tx = (result as SignTransactionResult).transaction
            const requested = params as TransactionRequest
            if (
                tx.FromAddress !== account.address ||
                tx.ToAddress !== requested.to ||
                tx.TransactionType !== requested.type ||
                tx.Amount !== Number(requested.amount) ||
                JSON.stringify(tx.Data) !== JSON.stringify(requested.data ?? null)
            ) {
                mismatch()
            }
        }
    }

    async clearConnections() {
        await this.deps.connections.clear()
    }
}
