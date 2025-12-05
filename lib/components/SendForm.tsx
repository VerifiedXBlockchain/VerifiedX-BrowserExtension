import { useState } from "react"
import { validateVfxAddress } from "~lib/utils";
import { VfxClient } from 'vfx-web-sdk';

import type { VfxAddress, IBtcKeypair, IAccountInfo } from "~types/types"
import { Network, Currency } from "~types/types";


interface SendFormProps {
    currency: Currency;
    network: Network;
    vfxAddress?: VfxAddress;
    btcKeypair?: IBtcKeypair;
    btcAccountInfo?: IAccountInfo;
    onSubmit: (toAddress: string, amount: number) => Promise<void>;
    onCreatePaymentLink?: () => void;
}

export default function SendForm({ currency, network, vfxAddress, btcKeypair, btcAccountInfo, onSubmit, onCreatePaymentLink }: SendFormProps) {
    const [toAddress, setToAddress] = useState('');
    const [amount, setAmount] = useState('');

    // Helper functions to get currency-specific data
    const getBalance = () => {
        if (currency === Currency.VFX) {
            return vfxAddress?.balance || 0;
        } else {
            return btcAccountInfo?.balance ? btcAccountInfo.balance / 100000000 : 0; // Convert satoshis to BTC
        }
    };

    const getFromAddress = () => {
        if (currency === Currency.VFX) {
            return vfxAddress?.address || '';
        } else {
            return btcKeypair?.address || btcKeypair?.addresses?.bech32 || '';
        }
    };

    const getCurrencySymbol = () => {
        return currency === Currency.VFX ? 'VFX' : 'BTC';
    };

    const validateAddress = (address: string) => {
        if (currency === Currency.VFX) {
            return validateVfxAddress(address, network);
        } else {
            // Basic BTC address validation - starts with bc1, tb1, 1, 3, etc.
            const btcPattern = /^(bc1|tb1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/;
            return btcPattern.test(address);
        }
    };

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

        // Domain lookup (currency-specific)
        if (currency === Currency.VFX && toAddress.endsWith('.vfx')) {
            try {
                setLoading(true);
                const client = new VfxClient(network);
                const domainAddress = await client.lookupDomain(toAddress);

                if (!domainAddress) {
                    setToAddressError("VFX domain not found");
                    hasError = true;
                } else {
                    resolvedAddress = domainAddress;
                    setToAddress(domainAddress); // Update UI to show resolved address
                }
            } catch (err) {
                console.log(err)
                setToAddressError("Failed to lookup VFX domain");
                hasError = true;
            } finally {
                setLoading(false);
            }
        } else if (currency === Currency.BTC && toAddress.endsWith('.btc')) {
            try {
                setLoading(true);
                const client = new VfxClient(network);
                const domainAddress = await client.lookupBtcDomain(toAddress);

                if (!domainAddress) {
                    setToAddressError("BTC domain not found");
                    hasError = true;
                } else {
                    resolvedAddress = domainAddress;
                    setToAddress(domainAddress); // Update UI to show resolved address
                }
            } catch (err) {
                console.log(err)
                setToAddressError("Failed to lookup BTC domain");
                hasError = true;
            } finally {
                setLoading(false);
            }
        } else if (!validateAddress(toAddress)) {
            setToAddressError(`Invalid ${getCurrencySymbol()} Address`);
            hasError = true;
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) {
            setAmountError("Invalid Amount");
            hasError = true;

        } else if (parsedAmount > getBalance()) {
            setAmountError("Insufficient Balance");
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
                    <div className="text-gray-400 text-xs">
                        {currency === Currency.VFX ? getBalance() : getBalance().toFixed(8)} {getCurrencySymbol()}
                    </div>
                </div>
                <div className="flex items-center justify-between bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
                    <span className="truncate">{getFromAddress()}</span>
                </div>


            </div>

            <div>
                <label htmlFor="toAddress" className="block text-xs font-medium text-gray-400 mb-1">To</label>
                <input
                    id="toAddress"
                    type="text"
                    value={toAddress}
                    onChange={(e) => setToAddress(e.target.value)}
                    placeholder={currency === Currency.VFX ? "Enter address or domain.vfx" : "Enter address or domain.btc"}
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
                    <span className="px-4 text-gray-400">{getCurrencySymbol()}</span>
                </div>
                {amountError && <div className="text-xs mt-1 text-red-500">{amountError}</div>}

            </div>

            <button
                type="submit"
                disabled={loading}
                className={`w-full font-semibold py-2 rounded-lg transition flex items-center justify-center ${loading
                        ? 'bg-gray-600 cursor-not-allowed'
                        : currency === Currency.VFX
                            ? 'bg-blue-600 hover:bg-blue-500'
                            : 'bg-orange-600 hover:bg-orange-500'
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

            {currency === Currency.VFX && onCreatePaymentLink && (
                <button
                    type="button"
                    onClick={onCreatePaymentLink}
                    className="w-full font-semibold py-2 rounded-lg transition flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                    Create Payment Link
                </button>
            )}
        </form>
    )
}