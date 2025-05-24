// popup/pages/Home.tsx

import { useEffect, useState } from "react"
import { copyToClipboard } from "~lib/utils" // you'll make this helper
import type { Account, Keypair, Network, VfxAddress } from "~types/types"
import cube from 'data-base64:~assets/vfx-cube.png'
import wordmark from 'data-base64:~assets/wordmark.png'
import SendForm from "~lib/components/SendForm"
import TransactionList from "~lib/components/TransactionList"
import { useToast } from "~lib/hooks/useToast"
import Toast from "~lib/components/Toast"
interface HomeProps {
    network: Network
    account: Account
    onLock: () => void
}

export default function Home({ network, account, onLock }: HomeProps) {
    const [addressDetails, setAddressDetails] = useState<VfxAddress | null>(null)
    const [section, setSection] = useState<"Main" | "Send" | "Transactions">("Main")
    const { message, showToast } = useToast()


    const handleCopyAddress = () => {
        if (account?.address) {
            copyToClipboard(account.address)
        }
    }

    const fetchDetails = async () => {


        try {
            const client = new window.vfx.VfxClient(network);
            const addressDetails = await client.getAddressDetails(account.address)
            setAddressDetails(addressDetails)
        } catch (err) {
            console.error("Failed to fetch balance:", err)
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

            return hash;

        } catch (err) {
            console.error("Failed to fetch balance:", err)
            return null;
        }
    }

    useEffect(() => {
        if (!account?.address) return
        fetchDetails()
        const interval = setInterval(() => {
            fetchDetails()
        }, 10_000)

        return () => clearInterval(interval)
    }, [account?.address])

    if (!addressDetails) {
        return <div></div>
    }


    return (
        <div className="flex flex-col text-white  min-h-56 bg-zinc-950">
            <div className="flex justify-between items-center flex-row bg-zinc-900 p-3 shadow-md">
                <div className="flex flex-row items-center space-x-2">
                    <img src={cube} width={32} height={32} />
                    <img src={wordmark} width={100} />
                </div>
                <div className="pt-1">
                    <button>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                        </svg>

                    </button>
                </div>
            </div>

            <div className="py-2"></div>


            {section == "Main" && (

                <div>
                    <div className="px-3">

                        <div className="flex flex-row justify-center items-center space-x-1">
                            <div className="text-2xl font-light">{addressDetails.balance}</div>
                            <div className="text-2xl text-gray-400">VFX</div>
                        </div>
                        <div className="py-1"></div>

                        <div className="flex flex-row space-x-2 justify-center">
                            <button
                                onClick={handleCopyAddress}
                                className="text-xs text-gray-400 hover:text-blue-400 "
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                                </svg>
                            </button>
                            <div className="text-center text-xs text-gray-400 break-all">{account.address}</div>

                        </div>
                        <div className="py-2"></div>


                        <div className="grid grid-cols-3 gap-3">
                            <button className="bg-blue-600 hover:bg-blue-500 p-3 rounded-lg font-semibold" onClick={() => setSection("Send")}>
                                Send
                            </button>
                            <button className="bg-blue-600 hover:bg-blue-500 p-3 rounded-lg font-semibold">
                                Receive
                            </button>
                            <button className="bg-blue-600 hover:bg-blue-500 p-3 rounded-lg font-semibold" onClick={() => setSection("Transactions")}>
                                Txs
                            </button>
                        </div>

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
                    </div>

                    <div className="w-12">&nbsp;</div>

                </div>
            )}

            {section == "Send" && (
                <div className="p-3">
                    <SendForm fromAddress={addressDetails} onSubmit={async (toAddress, amount) => {
                        const hash = await handleSendCoin(toAddress, amount);
                        if (hash != null) {
                            showToast("Transaction sent!")
                            setSection("Main");
                        }
                    }} />
                </div>
            )}

            {section == "Transactions" && (
                <div className="p-3">
                    <TransactionList address={addressDetails} network={network} />
                </div>
            )}

            <Toast message={message} />
        </div>

    )
}
