import type { Network, VfxAddress, IBtcKeypair } from "~types/types";
import { Currency } from "~types/types";
import CopyAddress from "./CopyAddress";
import { VfxClient } from 'vfx-web-sdk';
import { useState, useEffect } from "react"
import { validateDomain } from "~lib/utils";
import { getPendingTransactions } from "~lib/secureStorage";


interface ReceiveProps {
    currency: Currency;
    address?: VfxAddress;
    btcKeypair?: IBtcKeypair;
    network: Network;
    handleCreateVfxDomain: (domain: string) => Promise<void>;
}


export default function Receive({ currency, address, btcKeypair, network, handleCreateVfxDomain }: ReceiveProps) {

    const [creatingDomain, setCreatingDomain] = useState<boolean>(false);
    const [newDomain, setNewDomain] = useState<string>("");
    const [newDomainError, setNewDomainError] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(false);
    const [hasPendingDomain, setHasPendingDomain] = useState<boolean>(false);

    // Helper functions to get currency-specific data
    const getReceiveAddress = () => {
        if (currency === Currency.VFX) {
            return address?.address || '';
        } else {
            return btcKeypair?.address || btcKeypair?.addresses?.bech32 || '';
        }
    };

    const getAdnr = () => {
        return currency === Currency.VFX ? address?.adnr : null;
    };


    // Check for pending domain transactions (VFX only)
    useEffect(() => {
        const checkPendingDomains = async () => {
            if (currency === Currency.VFX && address?.address) {
                const pending = await getPendingTransactions(network, address.address);
                const hasDomainTx = pending.some(tx => tx.type_label === "Domain");
                setHasPendingDomain(hasDomainTx);
            } else {
                setHasPendingDomain(false);
            }
        };

        checkPendingDomains();

        // Poll every 5 seconds to update pending status
        const interval = setInterval(checkPendingDomains, 5000);
        return () => clearInterval(interval);
    }, [currency, network, address?.address]);

    const handleSubmit = async (e: React.FormEvent) => {

        e.preventDefault();
        setNewDomainError("");

        let hasError = false;

        const domainExtension = currency === Currency.VFX ? ".vfx" : ".btc";
        const domain = newDomain.trim().toLowerCase().replaceAll(domainExtension, "");

        if (!domain) {
            setNewDomainError("Domain Name Required");
            hasError = true;
        }

        if (!validateDomain(domain)) {
            setNewDomainError("Invalid domain. Must include only numbers, letters, and/or hyphens");
            hasError = true;
        }

        // Check if user has enough balance (VFX only for now)
        if (currency === Currency.VFX && address && address.balance < 5.0001) {
            setNewDomainError("Insufficient balance. Requires 5 VFX for domain creation + fees");
            hasError = true;
        }

        const client = new VfxClient(network)

        const isAvailable = await client.domainAvailable(domain);

        if (!isAvailable) {
            setNewDomainError("Domain name not available");
            hasError = true;
        }


        if (hasError) return;

        try {
            setLoading(true);
            await handleCreateVfxDomain(domain);
            setNewDomain("");
            setCreatingDomain(false);
        } finally {
            setLoading(false);
        }

    }
    return (
        <div className="flex flex-col space-y-1">
            <p className="text-center">Copy and Paste your address:</p>
            <CopyAddress address={getReceiveAddress()} network={network} adnr={getAdnr()} />

            {currency === Currency.VFX && !getAdnr() && (
                <div className='pt-2'>

                    {!creatingDomain && (

                        <div className="text-center ">
                            <button
                                disabled={hasPendingDomain}
                                className={`py-1 px-2 rounded-lg transition text-white ${
                                    hasPendingDomain
                                        ? 'bg-gray-600 cursor-not-allowed'
                                        : currency === Currency.VFX
                                            ? 'bg-blue-600 hover:bg-blue-500'
                                            : 'bg-orange-600 hover:bg-orange-500'
                                }`}
                                onClick={() => setCreatingDomain(true)}>
                                {hasPendingDomain ? 'Domain Pending...' : 'Create Domain'}
                            </button>
                        </div>
                    )}

                    {creatingDomain && (
                        <div>
                            <form onSubmit={handleSubmit} className=" space-y-3 max-w-[270px] mx-auto ">
                                <div className="h-[1px] w-full bg-slate-900"></div>
                                <div>
                                    <label htmlFor="toAddress" className="block text-xs font-medium text-gray-400 mb-1">Domain Name</label>
                                    <input
                                        id="toAddress"
                                        type="text"
                                        autoFocus
                                        value={newDomain}
                                        onChange={(e) => setNewDomain(e.target.value)}
                                        placeholder={`mydomain${currency === Currency.VFX ? '.vfx' : '.btc'}`}
                                        className="w-full bg-gray-800 text-white px-4 py-2 rounded-lg focus:outline-none"
                                    />
                                    {newDomainError && <div className="text-xs  mt-1 text-red-500">{newDomainError}</div>}
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className={`w-full font-semibold py-2 rounded-lg transition flex items-center justify-center ${
                                        loading
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
                                            Creating...
                                        </>
                                    ) : (
                                        'Create'
                                    )}
                                </button>
                            </form>

                        </div>
                    )}

                </div>
            )}

        </div>
    );

} 