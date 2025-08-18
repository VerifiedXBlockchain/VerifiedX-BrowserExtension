import type { Network, VfxAddress } from "~types/types";
import CopyAddress from "./CopyAddress";
import { useState } from "react"
import { validateDomain } from "~lib/utils";


interface ReceiveProps {
    address: VfxAddress;
    network: Network;

}


export default function Receive({ address, network }: ReceiveProps) {


    const [creatingDomain, setCreatingDomain] = useState<boolean>(false);
    const [newDomain, setNewDomain] = useState<string>("");
    const [newDomainError, setNewDomainError] = useState<string>("");


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

        const client = new window.vfx.VfxClient(network)

        const isAvailable = await client.domainAvailable(domain);

        if (!isAvailable) {
            setNewDomainError("Domain name not available");
            hasError = true;
        }


        if (hasError) return;

        //TODO create domain

    }
    return (
        <div className="flex flex-col space-y-1">
            <p className="text-center">Copy and Paste your address:</p>
            <CopyAddress address={address.address} network={network} />

            {!address.adnr && (
                <div className='pt-2'>

                    {!creatingDomain && (

                        <div className="text-center ">
                            <button
                                className="bg-blue-600 hover:bg-blue-500 text-white  py-1 px-2 rounded-lg transition"
                                onClick={() => setCreatingDomain(true)}>Create Domain
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
                                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 rounded-lg transition"
                                >
                                    Create
                                </button>
                            </form>

                        </div>
                    )}

                </div>
            )}

        </div>
    );

} 