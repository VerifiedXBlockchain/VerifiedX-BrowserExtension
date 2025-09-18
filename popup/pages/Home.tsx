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
import Receive from "~lib/components/Receive"
import CopyAddress from "~lib/components/CopyAddress"
import { addPendingTransaction, decryptBtcKeypair } from "~lib/secureStorage"
import NetworkToggle from "~lib/components/NetworkToggle"
import CurrencyToggle from "~lib/components/CurrencyToggle"
import OptionsMenu from "~lib/components/OptionsMenu"
import PasswordPrompt from "~lib/components/PasswordPrompt"
import EjectWalletConfirm from "~lib/components/EjectWalletConfirm"

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
    const [section, setSection] = useState<"Main" | "Send" | "Receive" | "Transactions" | "ExportKey" | "EjectWallet">("Main")
    const { message, showToast } = useToast()

    const fetchVfxDetails = async () => {
        try {
            const client = new window.vfx.VfxClient(network);
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
            const btcClient = new window.btc.BtcClient(network === Network.Mainnet ? 'mainnet' : 'testnet')
            const accountInfo = await btcClient.getAddressInfo(keypair.address || keypair.addresses.bech32 || '')
            setBtcAccountInfo(accountInfo)

        } catch (err) {
            console.error("Failed to fetch BTC details:", err)
        }
    }

    const handleSendCoin = async (toAddress: string, amount: number): Promise<string | null> => {
        try {
            const client = new window.vfx.VfxClient(network);
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
            }

            return hash;

        } catch (err) {
            console.error("Failed to send coin:", err)
            return null;
        }
    }

    const handleCreateDomain = async (domain: string): Promise<void> => {
        try {
            const client = new window.vfx.VfxClient(network);
            const kp: Keypair = {
                address: account.address,
                privateKey: account.private,
                publicKey: account.public,
            }

            const hash = await client.buyVfxDomain(kp, domain);

            if (hash) {
                // Create pending transaction immediately
                const pendingTx = {
                    hash: hash,
                    height: -1, // Use -1 to indicate pending
                    type: 2, // Assuming 2 is domain purchase type
                    type_label: "Domain",
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

    // Show loading if we don't have data for the current currency
    if (currency === Currency.VFX && !addressDetails) {
        return <div></div>
    }
    if (currency === Currency.BTC && !btcKeypair) {
        return <div></div>
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

            {/* Currency Toggle */}
            <div className="px-3 py-2 flex justify-center">
                <CurrencyToggle currency={currency} onCurrencyChange={onCurrencyChange} />
            </div>

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
                        {section == "Send" && "Send VFX"}
                        {section == "Transactions" && "Transactions"}
                        {section == "Receive" && "Receive VFX"}
                        {section == "ExportKey" && "Export Private Key"}
                        {section == "EjectWallet" && "Eject Wallet"}
                    </div>

                    <div className="w-12">&nbsp;</div>

                </div>
            )}

            {section == "Send" && (
                <div className="p-3">
                    <SendForm fromAddress={addressDetails} network={network} onSubmit={async (toAddress, amount) => {
                        const hash = await handleSendCoin(toAddress, amount);
                        if (hash != null) {
                            showToast("Transaction sent!")
                            setSection("Main");
                        }
                    }} />
                </div>
            )}

            {section == "Receive" && (
                <div className="p-3">
                    <Receive address={addressDetails} network={network} handleCreateVfxDomain={handleCreateDomain} />
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

            <Toast message={message} />
        </div>

    )
}
