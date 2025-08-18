import { useState } from "react"
import { validateVfxAddress } from "~lib/utils";

import type { VfxAddress } from "~types/types"
import { Network } from "~types/types";


interface SendFormProps {
    fromAddress: VfxAddress;
    network: Network;
    onSubmit: (toAddress: string, amount: number) => Promise<void>;
}

export default function SendForm({ fromAddress, onSubmit, network }: SendFormProps) {
    const [toAddress, setToAddress] = useState('');
    const [amount, setAmount] = useState('');

    const [toAddressError, setToAddressError] = useState('')
    const [amountError, setAmountError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setToAddressError("")
        setAmountError("")
        let hasError = false;

        if (!toAddress) {
            setToAddressError("To Address Required");
            hasError = true;
        }

        let resolvedAddress = toAddress;

        // Check if it's a domain
        if (toAddress.endsWith('.vfx')) {
            try {
                setLoading(true);
                const client = new window.vfx.VfxClient(network);
                const domainAddress = await client.lookupDomain(toAddress);

                if (!domainAddress) {
                    setToAddressError("Domain not found");
                    hasError = true;
                } else {
                    resolvedAddress = domainAddress;
                }
            } catch (err) {
                console.log(err)
                setToAddressError("Failed to lookup domain");
                hasError = true;
            } finally {
                setLoading(false);
            }
        } else if (!validateVfxAddress(toAddress, network)) {
            setToAddressError("Invalid Address");
            hasError = true;
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) {
            setAmountError("Invalid Amount");
            hasError = true;

        } else if (parsedAmount > fromAddress.balance) {
            setAmountError("Insufficent Balance");
            hasError = true;

        }

        if (hasError) return;

        try {
            setLoading(true);
            await onSubmit(resolvedAddress, parsedAmount);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="bg-gray-900 text-white p-6 rounded-2xl space-y-3 max-w-md mx-auto shadow-xl">
            <div>
                <div className="flex justify-between  mb-1">

                    <label className="block text-xs font-medium text-gray-400">From</label>
                    <div className=" text-gray-400 text-xs">{fromAddress.balance} VFX</div>
                </div>
                <div className="flex items-center justify-between bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
                    <span className="truncate">{fromAddress.address}</span>
                </div>


            </div>

            <div>
                <label htmlFor="toAddress" className="block text-xs font-medium text-gray-400 mb-1">To</label>
                <input
                    id="toAddress"
                    type="text"
                    value={toAddress}
                    onChange={(e) => setToAddress(e.target.value)}
                    placeholder="Enter address or domain.vfx"
                    className="w-full bg-gray-800 text-white px-4 py-2 rounded-lg focus:outline-none"
                />
                {toAddressError && <div className="text-xs  mt-1 text-red-500">{toAddressError}</div>}
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
                {amountError && <div className="text-xs mt-1 text-red-500">{amountError}</div>}

            </div>

            <button
                type="submit"
                disabled={loading}
                className={`w-full font-semibold py-2 rounded-lg transition flex items-center justify-center ${loading
                        ? 'bg-gray-600 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-500'
                    } text-white`}
            >
                {loading ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Sending...
                    </>
                ) : (
                    'Send'
                )}
            </button>
        </form>
    )
}