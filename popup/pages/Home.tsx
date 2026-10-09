// popup/pages/Home.tsx

import { useEffect, useState } from "react"
import { copyToClipboard } from "~lib/utils" // you'll make this helper
import type { Account, Keypair, VfxAddress, IBtcKeypair, IAccountInfo } from "~types/types"
import { Network, Currency } from "~types/types"
import cube from 'data-base64:~assets/vfx-cube.png'
import wordmark from 'data-base64:~assets/wordmark.png'
import SendForm from "~lib/components/SendForm"
import TransactionList from "~lib/components/TransactionList"
import { useToast } from "~lib/hooks/useToast"
import Toast from "~lib/components/Toast"
import { VfxClient, btc, TransactionDispatchError } from 'vfx-web-sdk'
import Receive from "~lib/components/Receive"
import CopyAddress from "~lib/components/CopyAddress"
import { addPendingTransaction, clearUncertainSend, decryptBtcKeypair, getUncertainSend, setUncertainSend } from "~lib/secureStorage"
import { checkDispatchOutcome, type UncertainSend } from "~lib/dispatchCheck"
import UncertainSendNotice from "~lib/components/UncertainSendNotice"
import NetworkToggle from "~lib/components/NetworkToggle"
import CurrencyToggle from "~lib/components/CurrencyToggle"
import OptionsMenu from "~lib/components/OptionsMenu"
import PasswordPrompt from "~lib/components/PasswordPrompt"
import EjectWalletConfirm from "~lib/components/EjectWalletConfirm"
import PaymentLink from "~lib/components/PaymentLink"

type SendResult =
    | { status: "sent"; hash: string }
    | { status: "uncertain"; hash: string }
    | { status: "failed" }

interface HomeProps {
    network: Network
    currency: Currency
    account: Account
    onNetworkChange: (network: Network) => void
    onCurrencyChange: (currency: Currency) => void
    onLock: () => void
    onEjectWallet: () => void
}

export default function Home({ network, currency, account, onNetworkChange, onCurrencyChange, onLock, onEjectWallet }: HomeProps) {
    const [addressDetails, setAddressDetails] = useState<VfxAddress | null>(null)
    const [btcKeypair, setBtcKeypair] = useState<IBtcKeypair | null>(null)
    const [btcAccountInfo, setBtcAccountInfo] = useState<IAccountInfo | null>(null)
    const [btcDomain, setBtcDomain] = useState<string | null>(null);
    const [section, setSection] = useState<"Main" | "Send" | "Receive" | "Transactions" | "ExportKey" | "EjectWallet" | "PaymentLink">("Main")
    const [uncertainSend, setUncertainSendState] = useState<UncertainSend | null>(null)
    const { message, showToast } = useToast()

    const recordUncertainSend = async (
        err: TransactionDispatchError,
        toAddress: string,
        amount: number,
        label: string,
        paymentLink?: UncertainSend["paymentLink"]
    ) => {
        const record: UncertainSend = {
            hash: err.hash,
            network,
            fromAddress: account.address,
            toAddress,
            amount,
            label,
            recordedAt: Date.now(),
            paymentLink
        }
        await setUncertainSend(record)
        setUncertainSendState(record)
    }

    // Load any unresolved send for this account and keep checking the chain
    // until it is found in a block or can no longer be included.
    useEffect(() => {
        if (!account?.address) return
        let cancelled = false

        const resolve = async () => {
            const record = await getUncertainSend(network, account.address)
            if (cancelled) return
            setUncertainSendState(record)
            if (!record) return

            const { outcome, chainTimeBasis } = await checkDispatchOutcome(record)
            if (chainTimeBasis !== undefined) {
                const updated = { ...record, chainTimeBasis }
                await setUncertainSend(updated)
                if (!cancelled) setUncertainSendState(updated)
            }
            if (cancelled || outcome === "unknown") return

            await clearUncertainSend(network, account.address)
            setUncertainSendState(null)
            if (outcome === "landed") {
                showToast(`${record.label} confirmed on chain`)
                fetchVfxDetails()
            } else {
                showToast(`${record.label} was not sent. You can send again.`)
            }
        }

        resolve()
        const interval = setInterval(resolve, 10_000)
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [account?.address, network])

    const fetchVfxDetails = async () => {
        try {
            const client = new VfxClient(network);
            const addressDetails = await client.getAddressDetails(account.address)
            setAddressDetails(addressDetails)
        } catch (err) {
            console.error("Failed to fetch VFX balance:", err)
        }
    }

    const fetchBtcDetails = async () => {
        try {
            // Get the current mnemonic (password) from background
            const { mnemonic } = await chrome.runtime.sendMessage({ type: "GET_MNEMONIC" })
            if (!mnemonic) {
                console.error("Wallet locked - cannot fetch BTC details")
                return
            }

            // Decrypt BTC keypair
            const keypair = await decryptBtcKeypair(mnemonic, network)
            setBtcKeypair(keypair)

            // Fetch BTC account info using the keypair
            const btcClient = new btc.BtcClient(network === Network.Mainnet ? 'mainnet' : 'testnet')
            const accountInfo = await btcClient.getAddressInfo(keypair.address || keypair.addresses.bech32 || '')
            setBtcAccountInfo(accountInfo)

            const vfxClient = new VfxClient(network);

            const btcDomain = await vfxClient.lookupBtcDomainFromBtcAddress(keypair.address)
            setBtcDomain(btcDomain);

        } catch (err) {
            console.error("Failed to fetch BTC details:", err)
        }
    }

    const handleSendCoin = async (toAddress: string, amount: number): Promise<SendResult> => {
        try {
            const client = new VfxClient(network);
            const kp: Keypair = {
                address: account.address,
                privateKey: account.private,
                publicKey: account.public,
            }

            const hash = await client.sendCoin(kp, toAddress, amount)

            // Create pending transaction immediately
            if (hash) {
                const pendingTx = {
                    hash: hash,
                    height: -1, // Use -1 to indicate pending
                    type: 1, // Assuming 1 is send type
                    type_label: "Tx",
                    to_address: toAddress,
                    from_address: account.address,
                    total_amount: amount,
                    total_fee: 0.0001, // Estimated fee
                    data: null,
                    date_crafted: new Date().toISOString(),
                    signature: "",
                    nft: null,
                    unlock_time: null,
                    callback_details: null,
                    recovery_details: null,
                    isPending: true // Flag to indicate this is pending
                }

                await addPendingTransaction(network, account.address, pendingTx)
                return { status: "sent", hash }
            }

            return { status: "failed" }

        } catch (err) {
            if (err instanceof TransactionDispatchError) {
                console.error("Send dispatched but outcome unknown:", err)
                await recordUncertainSend(err, toAddress, amount, "Send")
                return { status: "uncertain", hash: err.hash }
            }
            console.error("Failed to send coin:", err)
            return { status: "failed" }
        }
    }

    const handleSendBtc = async (toAddress: string, amount: number): Promise<string | null> => {
        try {
            if (!btcKeypair) {
                console.error("No BTC keypair available")
                return null;
            }

            const btcClient = new btc.BtcClient(network === Network.Mainnet ? 'mainnet' : 'testnet')
            // sendBtc takes the amount in BTC and converts to satoshis itself.
            return await btcClient.sendBtc(btcKeypair.wif, toAddress, amount);

        } catch (err) {
            console.error("❌ FAILED TO SEND BTC:", err)
            return null;
        }
    }

    const handleCreateDomain = async (domain: string, currency: Currency, btcPrivateKey?: string): Promise<void> => {
        try {
            const client = new VfxClient(network);
            const kp: Keypair = {
                address: account.address,
                privateKey: account.private,
                publicKey: account.public,
            }

            console.log("handleCreateDomain");

            let hash = "";
            if (currency == Currency.VFX) {
                hash = await client.buyVfxDomain(kp, domain);
            } else {
                console.log("btc");

                if (btcPrivateKey == null) {
                    throw Error("BTC Private Key Not Provided");
                }
                console.log("about to go");

                hash = await client.buyBtcDomain(kp, domain, btcPrivateKey);
                console.log("hash");

            }

            if (hash) {
                // Create pending transaction immediately
                const pendingTx = {
                    hash: hash,
                    height: -1, // Use -1 to indicate pending
                    type: 2, // Assuming 2 is domain purchase type
                    type_label: `${currency == Currency.VFX ? 'VFX' : "BTC"} Domain`,
                    to_address: account.address,
                    from_address: account.address,
                    total_amount: 5.0, // Domain cost
                    total_fee: 0.0001, // Estimated fee
                    data: domain,
                    date_crafted: new Date().toISOString(),
                    signature: "",
                    nft: null,
                    unlock_time: null,
                    callback_details: null,
                    recovery_details: null,
                    isPending: true // Flag to indicate this is pending
                }

                await addPendingTransaction(network, account.address, pendingTx);
                showToast("Transaction sent!")
            }
        } catch (err) {
            if (err instanceof TransactionDispatchError) {
                console.error("Domain purchase dispatched but outcome unknown:", err)
                await recordUncertainSend(err, account.address, 5.0, "Domain purchase")
                return
            }
            console.error("Failed to create domain:", err)
        }
    }

    useEffect(() => {
        const fetchData = async () => {
            if (currency === Currency.VFX) {
                if (!account?.address) return
                await fetchVfxDetails()
            } else if (currency === Currency.BTC) {
                await fetchBtcDetails()
            }
        }

        fetchData()
        const interval = setInterval(fetchData, 10_000)

        return () => clearInterval(interval)
    }, [account?.address, currency, network])

    // Show loading only for VFX if we don't have essential data
    // For BTC, we allow the UI to show even while loading since Send form can handle loading states
    if (currency === Currency.VFX && !addressDetails) {
        console.log("Loading VFX data...")
        return <div></div>
    }

    // Log BTC loading state but don't block UI
    if (currency === Currency.BTC && !btcKeypair) {
        console.log("Loading BTC data... btcKeypair:", btcKeypair)
    }


    return (
        <div className="flex flex-col text-white  min-h-56 bg-zinc-950">
            <div className="flex justify-between items-center flex-row bg-zinc-900 p-3 shadow-md">
                <div className="flex flex-row items-center space-x-2">
                    <img src={cube} width={32} height={32} />
                    <img src={wordmark} width={100} />
                </div>
                <div className="pt-1 flex items-center space-x-3">
                    <NetworkToggle network={network} onNetworkChange={onNetworkChange} />
                    <OptionsMenu
                        onExportPrivateKey={() => setSection("ExportKey")}
                        onLockWallet={onLock}
                        onEjectWallet={() => setSection("EjectWallet")}
                    />
                </div>
            </div>

            {/* Currency Toggle - hide on PaymentLink screen */}
            {section !== "PaymentLink" ? (
                <div className="px-3 py-2 flex justify-center">
                    <CurrencyToggle currency={currency} onCurrencyChange={onCurrencyChange} />
                </div>
            ) : (
                <div className="pt-3" />
            )}

            {section == "Main" && (

                <div>
                    <div className="px-3">

                        <div className="flex flex-row justify-center items-center space-x-1">
                            {currency === Currency.VFX ? (
                                <>
                                    <div className="text-2xl font-light">{addressDetails?.balance || 0}</div>
                                    <div className="text-2xl text-gray-400">VFX</div>
                                </>
                            ) : (
                                <>
                                    <div className="text-2xl font-light">{btcAccountInfo?.balance ? (btcAccountInfo.balance / 100000000).toFixed(8) : '0.00000000'}</div>
                                    <div className="text-2xl text-orange-400">BTC</div>
                                </>
                            )}
                        </div>
                        <div className="py-1"></div>
                        {currency === Currency.VFX ? (
                            addressDetails && <CopyAddress address={addressDetails.address} network={network} adnr={addressDetails.adnr} />
                        ) : (
                            btcKeypair && <CopyAddress address={btcKeypair.address || btcKeypair.addresses?.bech32 || ''} network={network} />
                        )}
                        <div className="py-2"></div>

                        {currency === Currency.VFX && uncertainSend && (
                            <div className="pb-3">
                                <UncertainSendNotice send={uncertainSend} />
                            </div>
                        )}

                        <div className="grid grid-cols-3 gap-3">
                            <button className={`${currency === Currency.VFX ? 'bg-blue-600 hover:bg-blue-500' : 'bg-orange-600 hover:bg-orange-500'} p-3 rounded-lg font-semibold`} onClick={() => setSection("Send")}>
                                Send
                            </button>
                            <button className={`${currency === Currency.VFX ? 'bg-blue-600 hover:bg-blue-500' : 'bg-orange-600 hover:bg-orange-500'} p-3 rounded-lg font-semibold`} onClick={() => setSection("Receive")}>
                                Receive
                            </button>
                            <button className={`${currency === Currency.VFX ? 'bg-blue-600 hover:bg-blue-500' : 'bg-orange-600 hover:bg-orange-500'} p-3 rounded-lg font-semibold`} onClick={() => setSection("Transactions")}>
                                Txs
                            </button>
                        </div>
                        <div className="pt-3"></div>

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Future: Add more action buttons here */}
                    </div>

                </div>)}

            {section != "Main" && (
                <div className='px-3 flex items-center'>

                    <div className="w-12">
                        <button onClick={() => setSection("Main")}><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                        </button>
                    </div>

                    <div className="flex-1 text-center text-lg font-light">
                        {section == "Send" && `Send ${currency === Currency.VFX ? 'VFX' : 'BTC'}`}
                        {section == "Transactions" && "Transactions"}
                        {section == "Receive" && `Receive ${currency === Currency.VFX ? 'VFX' : 'BTC'}`}
                        {section == "ExportKey" && "Export Private Key"}
                        {section == "EjectWallet" && "Eject Wallet"}
                        {section == "PaymentLink" && "Create Payment Link"}
                    </div>

                    <div className="w-12">&nbsp;</div>

                </div>
            )}

            {section == "Send" && (
                <div className="p-3 space-y-3">
                    {currency === Currency.VFX && uncertainSend && <UncertainSendNotice send={uncertainSend} />}
                    <SendForm
                        currency={currency}
                        network={network}
                        vfxAddress={addressDetails}
                        btcKeypair={btcKeypair}
                        btcAccountInfo={btcAccountInfo}
                        sendBlocked={currency === Currency.VFX && uncertainSend !== null}
                        onSubmit={async (toAddress, amount) => {
                            if (currency === Currency.VFX) {
                                const result = await handleSendCoin(toAddress, amount);
                                if (result.status === "sent") {
                                    showToast("Transaction sent!")
                                    setSection("Main");
                                } else if (result.status === "failed") {
                                    showToast("Transaction failed. Nothing was sent.")
                                }
                                // "uncertain": stay here; the notice above explains and Send stays disabled
                                return
                            }

                            const hash = await handleSendBtc(toAddress, amount);
                            if (hash != null) {
                                showToast("Transaction sent!")
                                setSection("Main");
                            } else {
                                showToast("Transaction failed.")
                            }
                        }}
                        onCreatePaymentLink={() => setSection("PaymentLink")}
                    />
                </div>
            )}

            {section == "Receive" && (
                <div className="p-3">
                    <Receive
                        currency={currency}
                        address={addressDetails}
                        btcKeypair={btcKeypair}
                        btcDomain={btcDomain}
                        network={network}
                        handleCreateVfxDomain={(domain) => handleCreateDomain(domain, Currency.VFX)}
                        handleCreateBtcDomain={(domain) => handleCreateDomain(domain, Currency.BTC, btcKeypair.privateKey)}
                    />
                </div>
            )}

            {section == "Transactions" && (
                <div className="p-3">
                    <TransactionList address={addressDetails} network={network} />
                </div>
            )}

            {section == "ExportKey" && (
                <div className="p-3">
                    <PasswordPrompt
                        network={network}
                        isOpen={true}
                        onClose={() => setSection("Main")}
                        onSuccess={() => {
                            copyToClipboard(account.private)
                            showToast("Private key copied to clipboard!")
                            setSection("Main")
                        }}
                    />
                </div>
            )}

            {section == "EjectWallet" && (
                <div className="p-3">
                    <EjectWalletConfirm
                        network={network}
                        isOpen={true}
                        onClose={() => setSection("Main")}
                        onConfirm={() => {
                            setSection("Main")
                            onEjectWallet()
                        }}
                    />
                </div>
            )}

            {section == "PaymentLink" && addressDetails && (
                <div className="p-3">
                    <PaymentLink
                        network={network}
                        vfxAddress={addressDetails}
                        account={account}
                        sendBlocked={uncertainSend !== null}
                        onDispatchUncertain={(err, link) =>
                            recordUncertainSend(err, link.escrowAddress, Number(link.total), "Payment link funding", {
                                linkId: link.linkId,
                                shortUrl: link.shortUrl,
                                fullUrl: link.fullUrl,
                                escrowAddress: link.escrowAddress
                            })
                        }
                        onSuccess={() => {
                            showToast("Payment link created!")
                            setSection("Main")
                            fetchVfxDetails() // Refresh balance
                        }}
                        onBack={() => setSection("Main")}
                    />
                </div>
            )}

            <Toast message={message} />
        </div>

    )
}
