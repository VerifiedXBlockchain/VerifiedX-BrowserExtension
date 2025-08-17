import { useState } from "react"
import { validateVfxAddress } from "~lib/utils";

import type { VfxAddress } from "~types/types"
import { Network } from "~types/types";


interface SendFormProps {
    fromAddress: VfxAddress;
    network: Network;
    onSubmit: (toAddress: string, amount: number) => void;
}

export default function SendForm({ fromAddress, onSubmit, network }: SendFormProps) {
    const [toAddress, setToAddress] = useState('');
    const [amount, setAmount] = useState('');

    const [toAddressError, setToAddressError] = useState('')
    const [amountError, setAmountError] = useState('')

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setToAddressError("")
        setAmountError("")
        let hasError = false;

        if (!toAddress) {
            setToAddressError("To Address Required");
            hasError = true;
        }

        if (!validateVfxAddress(toAddress, network)) {
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

        onSubmit(toAddress, parsedAmount);
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
                    placeholder="Enter recipient address"
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
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 rounded-lg transition"
            >
                Send
            </button>
        </form>
    )
}