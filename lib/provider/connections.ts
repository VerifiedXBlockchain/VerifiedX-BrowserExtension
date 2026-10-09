// Sites the user has connected. A connected site can read the wallet's
// address and public key without a popup and may ask for signatures (each of
// which still needs approval). A connection covers both networks; the site
// sees the account for whichever network the extension is on.

const STORAGE_KEY = "providerConnections"

export interface ConnectionRecord {
    connectedAt: number
}

export interface KeyValueArea {
    get(key: string): Promise<Record<string, unknown>>
    set(items: Record<string, unknown>): Promise<void>
}

export class ConnectionStore {
    constructor(private readonly area: KeyValueArea) {}

    private async all(): Promise<Record<string, ConnectionRecord>> {
        const stored = (await this.area.get(STORAGE_KEY))[STORAGE_KEY]
        return stored && typeof stored === "object" ? (stored as Record<string, ConnectionRecord>) : {}
    }

    async isConnected(origin: string): Promise<boolean> {
        return Object.prototype.hasOwnProperty.call(await this.all(), origin)
    }

    async connect(origin: string, now: number = Date.now()): Promise<void> {
        const connections = await this.all()
        connections[origin] = { connectedAt: now }
        await this.area.set({ [STORAGE_KEY]: connections })
    }

    async disconnect(origin: string): Promise<void> {
        const connections = await this.all()
        delete connections[origin]
        await this.area.set({ [STORAGE_KEY]: connections })
    }

    async clear(): Promise<void> {
        await this.area.set({ [STORAGE_KEY]: {} })
    }

    async list(): Promise<Record<string, ConnectionRecord>> {
        return this.all()
    }
}
