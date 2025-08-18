import type { Network, VfxAddress } from "~types/types";
import CopyAddress from "./CopyAddress";
import { useState, useEffect } from "react"
import { validateDomain } from "~lib/utils";
import { getPendingTransactions } from "~lib/secureStorage";


interface ReceiveProps {
    address: VfxAddress;
    network: Network;
    handleCreateVfxDomain: (domain: string) => Promise<void>;
}


export default function Receive({ address, network, handleCreateVfxDomain }: ReceiveProps) {

    const [creatingDomain, setCreatingDomain] = useState<boolean>(false);
    const [newDomain, setNewDomain] = useState<string>("");
    const [newDomainError, setNewDomainError] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(false);
    const [hasPendingDomain, setHasPendingDomain] = useState<boolean>(false);

    // Check for pending domain transactions
    useEffect(() => {
        const checkPendingDomains = async () => {
            const pending = await getPendingTransactions(network, address.address);
            const hasDomainTx = pending.some(tx => tx.type_label === "Domain");
            setHasPendingDomain(hasDomainTx);
        };
        
        checkPendingDomains();
        
        // Poll every 5 seconds to update pending status
        const interval = setInterval(checkPendingDomains, 5000);
        return () => clearInterval(interval);
    }, [network, address.address]);

    const handleSubmit = async (e: React.FormEvent) => {

        e.preventDefault();
        setNewDomainError("");

        let hasError = false;

        const domain = newDomain.trim().toLowerCase().replaceAll(".vfx", "");

        if (!domain) {
            setNewDomainError("Domain Name Required");
            hasError = true;
        }


        if (!validateDomain(domain)) {
            setNewDomainError("Invalid domain. Must include only numbers, letters, and/or hyphens");
            hasError = true;
        }

        // Check if user has enough balance (5.0001 VFX for domain + fee)
        if (address.balance < 5.0001) {
            setNewDomainError("Insufficient balance. Requires 5 VFX for domain creation + fees");
            hasError = true;
        }

        const client = new window.vfx.VfxClient(network)

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
            <CopyAddress address={address.address} network={network} adnr={address.adnr} />

            {!address.adnr && (
                <div className='pt-2'>

                    {!creatingDomain && (

                        <div className="text-center ">
                            <button
                                disabled={hasPendingDomain}
                                className={`py-1 px-2 rounded-lg transition text-white ${
                                    hasPendingDomain 
                                        ? 'bg-gray-600 cursor-not-allowed' 
                                        : 'bg-blue-600 hover:bg-blue-500'
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
                                        placeholder="mydomain.vfx"
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
                                            : 'bg-blue-600 hover:bg-blue-500'
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