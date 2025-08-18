import { useEffect, useState, useRef, useCallback } from "react"
import type { Network, Transaction, VfxAddress } from "~types/types"
import TransactionCard from "./TransactionCard"
import { getPendingTransactions, removePendingTransaction } from "~lib/secureStorage"

interface Props {
    address: VfxAddress
    network: Network
}

export default function TransactionList({ address, network }: Props) {
    const client = new window.vfx.VfxClient(network)

    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [pendingTransactions, setPendingTransactions] = useState<any[]>([])
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
                
                // Remove any pending transactions that now exist in real transactions
                const realHashes = new Set(data.results.map(tx => tx.hash))
                const pending = await getPendingTransactions(network, address.address)
                
                // Remove confirmed transactions from pending
                for (const pendingTx of pending) {
                    if (realHashes.has(pendingTx.hash)) {
                        await removePendingTransaction(network, address.address, pendingTx.hash)
                    }
                }
                
                // Update pending transactions
                const updatedPending = await getPendingTransactions(network, address.address)
                setPendingTransactions(updatedPending)
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
    }, [address.address, loading, numPages, network])

    // Load pending transactions initially
    useEffect(() => {
        const loadPending = async () => {
            const pending = await getPendingTransactions(network, address.address)
            setPendingTransactions(pending)
        }
        loadPending()
    }, [address.address, network])

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
                const page1 = await client.listTransactionsForAddress(address.address, 1)

                // Check for new transactions
                const newTxs = page1.results.filter(
                    (tx) => !transactions.find((t) => t.hash === tx.hash)
                )

                // Check if any pending transactions are now confirmed
                const realHashes = new Set(page1.results.map(tx => tx.hash))
                const currentPending = await getPendingTransactions(network, address.address)
                let pendingUpdated = false

                for (const pendingTx of currentPending) {
                    if (realHashes.has(pendingTx.hash)) {
                        await removePendingTransaction(network, address.address, pendingTx.hash)
                        pendingUpdated = true
                    }
                }

                // Update states if there are changes
                if (newTxs.length > 0) {
                    setTransactions((prev) => [...newTxs, ...prev])
                    setPage(page1.page)
                    setNumPages(page1.num_pages)
                }

                if (pendingUpdated) {
                    const updatedPending = await getPendingTransactions(network, address.address)
                    setPendingTransactions(updatedPending)
                }
            } catch (err) {
                console.error("Polling for new transactions failed:", err)
            }
        }, 10_000) // Reduced to 10 seconds for faster updates

        return () => clearInterval(pollForNewTxs)
    }, [address.address, transactions, network])

    // Combine pending and real transactions, pending first
    const allTransactions = [...pendingTransactions, ...transactions]

    return (
        <div className="space-y-4 overflow-y-auto">
            {!allTransactions.length && !loading && (
                <div className="text-sm text-gray-400 text-center">No transactions yet.</div>
            )}

            {allTransactions.map((tx) => (
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
