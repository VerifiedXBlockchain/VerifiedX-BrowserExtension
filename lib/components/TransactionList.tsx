import { useEffect, useState, useRef, useCallback } from "react"
import type { Network, Transaction, VfxAddress } from "~types/types"
import TransactionCard from "./TransactionCard"

interface Props {
    address: VfxAddress
    network: Network
}

export default function TransactionList({ address, network }: Props) {
    const client = new window.vfx.VfxClient(network)

    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [page, setPage] = useState<number>(1)
    const [numPages, setNumPages] = useState<number>(1)
    const [loading, setLoading] = useState(false)

    const observerRef = useRef<HTMLDivElement | null>(null)

    const fetchTransactions = useCallback(async (pageNum: number) => {
        if (loading || pageNum > numPages) return

        try {
            setLoading(true)
            const data = await client.listTransactionsForAddress(address.address, pageNum)


            if (pageNum === 1) {
                setTransactions(data.results)
            } else {
                setTransactions((prev) => [...prev, ...data.results])
            }

            setPage(data.page)
            setNumPages(data.num_pages)
        } catch (err) {
            console.error("Failed to fetch transactions:", err)
        } finally {
            setLoading(false)
        }
    }, [address.address, loading, numPages])

    // Initial load
    useEffect(() => {
        setTransactions([])
        setPage(1)
        setNumPages(1)
        fetchTransactions(1)
    }, [address.address])

    // Infinite scroll observer
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries
                if (entry.isIntersecting && page < numPages && !loading) {
                    fetchTransactions(page + 1)
                }
            },
            {
                rootMargin: "100px"
            }
        )

        const node = observerRef.current
        if (node) observer.observe(node)

        return () => {
            if (node) observer.unobserve(node)
        }
    }, [page, numPages, loading, fetchTransactions])

    useEffect(() => {
        const pollForNewTxs = setInterval(async () => {
            try {
                if (transactions.length === 0) return

                const page1 = await client.listTransactionsForAddress(address.address, 1)

                const newTxs = page1.results.filter(
                    (tx) => !transactions.find((t) => t.hash === tx.hash)
                )

                if (newTxs.length > 0) {
                    setTransactions((prev) => [...newTxs, ...prev])
                    setPage(page1.page)
                    setNumPages(page1.num_pages)
                }
            } catch (err) {
                console.error("Polling for new transactions failed:", err)
            }
        }, 30_000)

        return () => clearInterval(pollForNewTxs)
    }, [address.address, transactions])

    return (
        <div className="space-y-4 overflow-y-auto">
            {!transactions.length && !loading && (
                <div className="text-sm text-gray-400 text-center">No transactions yet.</div>
            )}

            {transactions.map((tx) => (
                <TransactionCard key={tx.hash} tx={tx} address={address.address} network={network} />
            ))}

            {/* Invisible div triggers fetch when scrolled into view */}
            <div ref={observerRef} className="h-1" />

            {loading && (
                <div className="text-sm text-center text-gray-500">Loading more transactions...</div>
            )}
        </div>
    )
}
