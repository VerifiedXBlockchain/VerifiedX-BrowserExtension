// The requesting site and the signing account, shown at the top of every
// approval popup for the structured signing methods.

export function hostname(origin: string): string {
    try {
        return new URL(origin).hostname
    } catch {
        return origin
    }
}

interface RequestSiteProps {
    origin: string
    accountLabel: string
    address: string
}

export default function RequestSite({ origin, accountLabel, address }: RequestSiteProps) {
    return (
        <>
            <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Requesting site:</p>
                <p className="text-lg font-mono break-all" data-testid="request-origin">
                    {hostname(origin)}
                </p>
                <p className="text-xs text-gray-500 mt-1 break-all">{origin}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">{accountLabel}:</p>
                <p className="text-sm font-mono break-all">{address}</p>
            </div>
        </>
    )
}
