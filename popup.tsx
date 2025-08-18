import { useEffect, useState } from "react"
import "./style.css"
import cube from 'data-base64:~assets/vfx-cube.png'
import wordmark from 'data-base64:~assets/wordmark.png'
import SetupWallet from "~popup/pages/SetupWallet"
import BackupMnemonic from "~popup/pages/BackupMnemonic"
import { isWalletCreated, getNetwork, setNetwork, clearWallet } from "~lib/secureStorage"
import Home from "~popup/pages/Home"
import Unlock from "~popup/pages/Unlock"
import ImportPrivateKey from "~popup/pages/ImportPrivateKey"
import RecoverMnemonic from "~popup/pages/RecoverMnemonic"
import NetworkToggle from "~lib/components/NetworkToggle"
import { Network, type Account } from "~types/types"
import "assets/vfx.js"
import { createAccountFromSecret } from "~lib/utils"

function IndexPopup() {
  const [network, setNetworkState] = useState<Network>(Network.Testnet)
  const [mnemonic, setMnemonic] = useState("")
  const [password, setPassword] = useState("")
  const [account, setAccount] = useState<Account | null>(null)
  const [screen, setScreen] = useState<"Booting" | "SetupWallet" | "BackupMnemonic" | "Unlock" | "Home" | "RecoverMnemonic" | "ImportPrivateKey">("Booting")

  useEffect(() => {
    const init = async () => {
      const savedNetwork = await getNetwork()
      setNetworkState(savedNetwork)

      const hasWallet = await isWalletCreated(savedNetwork)

      if (!hasWallet) {
        setScreen("SetupWallet")
        return
      }

      const { unlocked } = await chrome.runtime.sendMessage({ type: "IS_UNLOCKED" })

      if (unlocked) {
        const { mnemonic } = await chrome.runtime.sendMessage({ type: "GET_MNEMONIC" })

        if (!mnemonic) {
          console.error("Unlocked but no mnemonic available")
          setScreen("Unlock")
          return
        }

        const account = createAccountFromSecret(savedNetwork, mnemonic, 0);

        setAccount(account)
        setScreen("Home")
      } else {
        setScreen("Unlock")
      }
    }

    init()
  }, [])

  useEffect(() => {
    const handleActivity = async () => {
      // Reset unlock timeout in background memory
      await chrome.runtime.sendMessage({ type: "RESET_UNLOCK_TIMER" })
    }

    window.addEventListener("mousemove", handleActivity)
    window.addEventListener("keydown", handleActivity)

    return () => {
      window.removeEventListener("mousemove", handleActivity)
      window.removeEventListener("keydown", handleActivity)
    }
  }, [])

  const handleNetworkChange = async (newNetwork: Network) => {
    await setNetwork(newNetwork)
    setNetworkState(newNetwork)

    setAccount(null)
    setScreen("Booting")

    setTimeout(async () => {
      const hasWallet = await isWalletCreated(newNetwork)

      if (!hasWallet) {
        setScreen("SetupWallet")
        return
      }

      const { unlocked } = await chrome.runtime.sendMessage({ type: "IS_UNLOCKED" })

      if (unlocked) {
        const { mnemonic } = await chrome.runtime.sendMessage({ type: "GET_MNEMONIC" })

        if (mnemonic) {
          const account = createAccountFromSecret(newNetwork, mnemonic, 0);
          setAccount(account)
          setScreen("Home")
        } else {
          setScreen("Unlock")
        }
      } else {
        setScreen("Unlock")
      }
    }, 100)
  }

  const handleEjectWallet = async () => {
    await clearWallet(network)
    await chrome.runtime.sendMessage({ type: "LOCK_WALLET" })
    setAccount(null)
    setScreen("SetupWallet")
  }

  const handleSetupNetworkChange = async (newNetwork: Network) => {
    // Show booting state briefly to prevent flashing
    setScreen("Booting")
    
    await setNetwork(newNetwork)
    setNetworkState(newNetwork)
    
    // Check if this network already has a wallet
    const hasWallet = await isWalletCreated(newNetwork)
    
    if (hasWallet) {
      // Network has existing wallet - check if it's unlocked
      const { unlocked } = await chrome.runtime.sendMessage({ type: "IS_UNLOCKED" })
      
      if (unlocked) {
        const { mnemonic } = await chrome.runtime.sendMessage({ type: "GET_MNEMONIC" })
        
        if (mnemonic) {
          const account = createAccountFromSecret(newNetwork, mnemonic, 0);
          setAccount(account)
          setScreen("Home")
        } else {
          setScreen("Unlock")
        }
      } else {
        setScreen("Unlock")
      }
    } else {
      // No wallet exists for this network, go to setup
      setScreen("SetupWallet")
    }
  }

  if (screen == "Booting") {
    return <div className="bg-gray-950 w-96 min-h-56 text-white"></div>

  }

  return (
    <div className="relative bg-gray-950 w-96 text-white">
      {screen !== "Home" && (
        <>
          <div className="absolute top-3 right-3 text-xs z-10">
            <NetworkToggle network={network} onNetworkChange={handleSetupNetworkChange} />
          </div>
          <div className="flex justify-center items-center flex-col pt-4">
            <img src={cube} width={64} height={64} />
            <div className="pt-1" />
            <img src={wordmark} width={100} />
          </div>
        </>
      )}


      {screen === "SetupWallet" && (
        <SetupWallet
          network={network}
          onCreate={(createdMnemonic) => {
            setMnemonic(createdMnemonic)
            setScreen("BackupMnemonic")
          }}
          onRecoverMnemonic={(pwd) => {
            setPassword(pwd)
            setScreen("RecoverMnemonic")
          }}
          onImportPrivateKey={(pwd) => {
            setPassword(pwd)
            setScreen("ImportPrivateKey")
          }}
        />
      )}

      {screen === "BackupMnemonic" && (
        <BackupMnemonic
          network={network}
          mnemonic={mnemonic}
          onConfirm={() => {
            const account = createAccountFromSecret(network, mnemonic, 0);



            setAccount(account)
            setScreen("Home")
          }}
        />
      )}

      {screen === "Unlock" && (
        <Unlock
          network={network}
          onUnlockSuccess={(account) => {
            setAccount(account)
            setScreen("Home")
          }}
        />
      )}

      {screen === "Home" && (
        <Home
          network={network}
          account={account}
          onNetworkChange={handleNetworkChange}
          onLock={async () => {
            await chrome.runtime.sendMessage({ type: "LOCK_WALLET" })
            setAccount(null)
            setScreen("Unlock")
          }}
          onEjectWallet={handleEjectWallet}
        />
      )}

      {screen === "RecoverMnemonic" && (
        <RecoverMnemonic
          network={network}
          password={password}
          onSuccess={(account) => {
            setAccount(account)
            setScreen("Home")
          }}
          onBack={() => setScreen("SetupWallet")}
        />
      )}

      {screen === "ImportPrivateKey" && (
        <ImportPrivateKey
          network={network}
          password={password}
          onSuccess={(account) => {
            setAccount(account)
            setScreen("Home")
          }}
          onBack={() => setScreen("SetupWallet")}
        />
      )}
    </div>
  )
}

export default IndexPopup
