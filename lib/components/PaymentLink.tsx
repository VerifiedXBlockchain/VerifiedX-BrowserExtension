import { useState, useEffect } from "react"
import type { VfxAddress, Keypair } from "~types/types"
import { Network } from "~types/types"
import {
    createPaymentLink,
    pollForFunding,
    PAYMENT_LINK_ICONS,
    type PaymentLinkIcon,
    type CreatePaymentLinkResponse,
    type PaymentLinkStatus
} from "~lib/butterflyApi"
import { copyToClipboard } from "~lib/utils"
import { getVfxPrice, formatUsd } from "~lib/priceApi"
import { VfxClient } from 'vfx-web-sdk'

interface PaymentLinkProps {
    network: Network
    vfxAddress: VfxAddress
    account: {
        address: string
        private: string
        public: string
    }
    onSuccess?: () => void
    onBack?: () => void
}

type Step = 'form' | 'confirm' | 'sending' | 'polling' | 'success' | 'error'

const ICON_EMOJIS: Record<PaymentLinkIcon, string> = {
    default: '💳',
    gift: '🎁',
    money: '💰',
    heart: '❤️',
    party: '🎉',
    rocket: '🚀',
    star: '⭐'
}

export default function PaymentLink({ network, vfxAddress, account, onSuccess, onBack }: PaymentLinkProps) {
    const [step, setStep] = useState<Step>('form')
    const [amount, setAmount] = useState('')
    const [message, setMessage] = useState('')
    const [icon, setIcon] = useState<PaymentLinkIcon>('default')
    const [amountError, setAmountError] = useState('')
    const [linkData, setLinkData] = useState<CreatePaymentLinkResponse | null>(null)
    const [finalStatus, setFinalStatus] = useState<PaymentLinkStatus | null>(null)
    const [error, setError] = useState('')
    const [copied, setCopied] = useState(false)
    const [pollingStatus, setPollingStatus] = useState('')
    const [vfxPrice, setVfxPrice] = useState<number | null>(null)

    const balance = vfxAddress?.balance || 0

    // Fetch VFX price on mount
    useEffect(() => {
        getVfxPrice(network).then(setVfxPrice)
    }, [network])

    // Calculate USD values and fee
    const amountNum = parseFloat(amount) || 0
    const usdValue = vfxPrice ? amountNum * vfxPrice : null
    const balanceUsd = vfxPrice ? balance * vfxPrice : null
    // Fee is $0.01 USD converted to VFX
    const feeUsd = 0.01
    const feeVfx = vfxPrice ? feeUsd / vfxPrice : 0.01 // fallback to 0.01 VFX if no price
    const totalVfx = amountNum + feeVfx
    const totalUsd = usdValue !== null ? usdValue + feeUsd : null

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        setAmountError('')

        const parsedAmount = parseFloat(amount)
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            setAmountError('Enter a valid amount')
            return
        }

        // Check balance including fee
        if (parsedAmount + feeVfx > balance) {
            setAmountError(`Insufficient balance (includes ~${feeVfx.toFixed(4)} VFX fee)`)
            return
        }

        setStep('confirm')
    }

    const handleConfirm = async () => {
        setStep('sending')
        setError('')

        try {
            // Step 1: Create payment link
            console.log('[PaymentLink] Creating payment link...', { network, amount, message, icon })
            const response = await createPaymentLink(network, amount, message || undefined, icon)
            console.log('[PaymentLink] Payment link created:', response)
            setLinkData(response)

            // Step 2: Send VFX to escrow
            console.log('[PaymentLink] Sending VFX to escrow:', response.escrow_address, 'amount:', response.amount)
            const client = new VfxClient(network)
            const kp: Keypair = {
                address: account.address,
                privateKey: account.private,
                publicKey: account.public,
            }

            const txAmount = parseFloat(response.amount)
            const hash = await client.sendCoin(kp, response.escrow_address, txAmount)
            console.log('[PaymentLink] Transaction hash:', hash)

            if (!hash) {
                throw new Error('Transaction failed - no hash returned')
            }

            // Step 3: Poll for funding confirmation
            setStep('polling')
            setPollingStatus('Waiting for confirmation...')
            console.log('[PaymentLink] Polling for funding confirmation, link_id:', response.link_id)

            const status = await pollForFunding(
                response.link_id,
                (s) => {
                    console.log('[PaymentLink] Poll status:', s.status, 'short_url:', s.short_url)
                    setPollingStatus(s.short_url ? 'Link ready!' : 'Waiting for confirmation...')
                },
                60,
                5000
            )

            console.log('[PaymentLink] Final status:', status)
            setFinalStatus(status)
            setStep('success')

        } catch (err) {
            console.error('[PaymentLink] Error:', err)
            setError(err instanceof Error ? err.message : 'Failed to create payment link')
            setStep('error')
        }
    }

    const handleCopyLink = () => {
        const url = finalStatus?.full_url || linkData?.full_url
        if (url) {
            copyToClipboard(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    const handleShare = async () => {
        const url = finalStatus?.full_url || linkData?.full_url
        if (url && navigator.share) {
            try {
                await navigator.share({
                    title: 'VFX Payment Link',
                    text: message || 'Click to claim your VFX!',
                    url
                })
            } catch (err) {
                // User cancelled or share failed, fall back to copy
                handleCopyLink()
            }
        } else {
            handleCopyLink()
        }
    }

    // Form Step
    if (step === 'form') {
        return (
            <form onSubmit={handleSubmit} className="bg-gray-900 text-white p-6 rounded-2xl space-y-4 max-w-md mx-auto shadow-xl">
                <div className="text-center mb-2">
                    <div className="text-sm text-gray-400">Available Balance</div>
                    <div className="text-lg">{balance} VFX</div>
                    {balanceUsd !== null && (
                        <div className="text-sm text-gray-500">{formatUsd(balanceUsd)}</div>
                    )}
                    <div className="text-xs text-gray-600 mt-1">
                        {vfxPrice !== null
                            ? `1 VFX = ${formatUsd(vfxPrice)}`
                            : 'Loading price...'
                        }
                    </div>
                </div>

                <div>
                    <label htmlFor="amount" className="block text-xs font-medium text-gray-400 mb-1">Amount</label>
                    <div className="flex items-center bg-gray-800 rounded-lg overflow-hidden">
                        <input
                            id="amount"
                            type="text"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-transparent text-white px-4 py-2 focus:outline-none"
                        />
                        <span className="px-4 text-gray-400">VFX</span>
                    </div>
                    {usdValue !== null && amountNum > 0 && (
                        <div className="text-sm mt-1 text-blue-400">{formatUsd(usdValue)} USD</div>
                    )}
                    {amountError && <div className="text-xs mt-1 text-red-500">{amountError}</div>}
                    <div className="text-xs mt-1 text-gray-500">
                        A ~$0.01 fee ({vfxPrice ? `~${feeVfx.toFixed(4)} VFX` : '...'}) will be added
                    </div>
                </div>

                <div>
                    <label htmlFor="message" className="block text-xs font-medium text-gray-400 mb-1">Message (optional)</label>
                    <input
                        id="message"
                        type="text"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="e.g., Thanks for lunch!"
                        maxLength={100}
                        className="w-full bg-gray-800 text-white px-4 py-2 rounded-lg focus:outline-none"
                    />
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">Icon</label>
                    <div className="flex flex-wrap gap-1 justify-center">
                        {PAYMENT_LINK_ICONS.map((iconOption) => (
                            <button
                                key={iconOption}
                                type="button"
                                onClick={() => setIcon(iconOption)}
                                className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition ${icon === iconOption
                                    ? 'bg-blue-600 ring-2 ring-blue-400'
                                    : 'bg-gray-800 hover:bg-gray-700'
                                    }`}
                            >
                                {ICON_EMOJIS[iconOption]}
                            </button>
                        ))}
                    </div>
                </div>

                <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-500 font-semibold py-2 rounded-lg transition text-white"
                >
                    Continue
                </button>
            </form>
        )
    }

    // Confirm Step
    if (step === 'confirm') {
        return (
            <div className="bg-gray-900 text-white p-6 rounded-2xl space-y-4 max-w-md mx-auto shadow-xl">
                <div className="text-center">
                    <div className="text-4xl mb-2">{ICON_EMOJIS[icon]}</div>
                    <div className="text-2xl font-bold">{amount} VFX</div>
                    {usdValue !== null && (
                        <div className="text-lg text-blue-400">{formatUsd(usdValue)}</div>
                    )}
                    {message && <div className="text-gray-400 mt-1">"{message}"</div>}
                </div>

                <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Recipient receives</span>
                        <div className="text-right">
                            <div>{amount} VFX</div>
                            {usdValue !== null && <div className="text-xs text-gray-500">{formatUsd(usdValue)}</div>}
                        </div>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Platform fee</span>
                        <div className="text-right">
                            <div>~{feeVfx.toFixed(4)} VFX</div>
                            <div className="text-xs text-gray-500">$0.01</div>
                        </div>
                    </div>
                    <div className="border-t border-gray-700 pt-2 flex justify-between">
                        <span className="text-gray-400">You send</span>
                        <div className="text-right">
                            <div className="font-semibold">~{totalVfx.toFixed(4)} VFX</div>
                            {totalUsd !== null && <div className="text-xs text-gray-500">{formatUsd(totalUsd)}</div>}
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={() => setStep('form')}
                        className="flex-1 bg-gray-700 hover:bg-gray-600 font-semibold py-2 rounded-lg transition"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 font-semibold py-2 rounded-lg transition"
                    >
                        Create Link
                    </button>
                </div>
            </div>
        )
    }

    // Sending/Polling Step
    if (step === 'sending' || step === 'polling') {
        return (
            <div className="bg-gray-900 text-white p-6 rounded-2xl space-y-4 max-w-md mx-auto shadow-xl text-center">
                <div className="flex justify-center">
                    <svg className="animate-spin h-12 w-12 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
                <div className="text-lg font-semibold">
                    {step === 'sending' ? 'Creating Payment Link...' : 'Waiting for Confirmation...'}
                </div>
                <div className="text-sm text-gray-400">
                    {step === 'sending'
                        ? 'Sending transaction to escrow'
                        : pollingStatus || 'This may take up to 20 seconds'
                    }
                </div>
            </div>
        )
    }

    // Success Step
    if (step === 'success') {
        const shortUrl = finalStatus?.short_url || linkData?.short_url || ''
        const statusUsdValue = finalStatus?.usd_value ? parseFloat(finalStatus.usd_value) : usdValue

        return (
            <div className="bg-gray-900 text-white p-6 rounded-2xl space-y-4 max-w-md mx-auto shadow-xl">
                <div className="text-center">
                    <div className="text-4xl mb-2">✅</div>
                    <div className="text-xl font-semibold">Payment Link Created!</div>
                    <div className="text-gray-400 mt-1">{amount} VFX ready to claim</div>
                    {statusUsdValue !== null && (
                        <div className="text-blue-400">{formatUsd(statusUsdValue)}</div>
                    )}
                </div>

                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-xs text-gray-400 mb-1">Share this link</div>
                    <div className="text-sm break-all text-blue-400">{shortUrl}</div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={handleCopyLink}
                        className="flex-1 bg-gray-700 hover:bg-gray-600 font-semibold py-3 rounded-lg transition flex items-center justify-center gap-2"
                    >
                        {copied ? (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                                Copied!
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                                </svg>
                                Copy Link
                            </>
                        )}
                    </button>
                    <button
                        onClick={handleShare}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 font-semibold py-3 rounded-lg transition flex items-center justify-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                        </svg>
                        Share
                    </button>
                </div>

                <button
                    onClick={onSuccess || onBack}
                    className="w-full bg-gray-800 hover:bg-gray-700 font-semibold py-2 rounded-lg transition text-gray-300"
                >
                    Done
                </button>
            </div>
        )
    }

    // Error Step
    if (step === 'error') {
        return (
            <div className="bg-gray-900 text-white p-6 rounded-2xl space-y-4 max-w-md mx-auto shadow-xl text-center">
                <div className="text-4xl">❌</div>
                <div className="text-xl font-semibold">Something went wrong</div>
                <div className="text-sm text-red-400">{error}</div>
                <button
                    onClick={() => setStep('form')}
                    className="w-full bg-gray-700 hover:bg-gray-600 font-semibold py-2 rounded-lg transition"
                >
                    Try Again
                </button>
            </div>
        )
    }

    return null
}
