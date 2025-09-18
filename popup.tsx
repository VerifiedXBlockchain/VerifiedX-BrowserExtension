import { useEffect, useState } from "react"
import "./style.css"
import cube from 'data-base64:~assets/vfx-cube.png'
import wordmark from 'data-base64:~assets/wordmark.png'
import SetupWallet from "~popup/pages/SetupWallet"
import BackupMnemonic from "~popup/pages/BackupMnemonic"
import SetupBtc from "~popup/pages/SetupBtc"
import { isWalletCreated, hasAnyWallet, getNetwork, setNetwork, clearWallet, encryptBtcKeypair } from "~lib/secureStorage"
import Home from "~popup/pages/Home"
import Unlock from "~popup/pages/Unlock"
import ImportPrivateKey from "~popup/pages/ImportPrivateKey"
import RecoverMnemonic from "~popup/pages/RecoverMnemonic"
import NetworkToggle from "~lib/components/NetworkToggle"
import { Network, Currency, type Account } from "~types/types"
import "assets/vfx.js"
import "assets/btc.js"
import { createAccountFromSecret, createBtcKeypairFromVfx } from "~lib/utils"

function IndexPopup() {
  const [network, setNetworkState] = useState<Network>(Network.Testnet)
  const [currency, setCurrency] = useState<Currency>(Currency.VFX)
  const [mnemonic, setMnemonic] = useState("")
  const [password, setPassword] = useState("")
  const [account, setAccount] = useState<Account | null>(null)
  const [screen, setScreen] = useState<"Booting" | "SetupWallet" | "BackupMnemonic" | "Unlock" | "Home" | "RecoverMnemonic" | "ImportPrivateKey" | "SetupBtc">("Booting")

  useEffect(() => {
    const init = async () => {
      const savedNetwork = await getNetwork()
      setNetworkState(savedNetwork)

      const hasWallet = await hasAnyWallet()

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

        const account = createAccountFromSecret(savedNetwork, mnemonic);

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

      // Always go through unlock to ensure we get the correct network's private key
      setScreen("Unlock")
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
        // We need to get the mnemonic for this specific network
        // The background memory might have the wrong network's mnemonic
        // So we need to use the Unlock component to get the right mnemonic
        setScreen("Unlock")
      } else {
        setScreen("Unlock")
      }
    } else {
      // No wallet exists for this network - check if user has wallet on other network
      const hasAnyWalletExists = await hasAnyWallet()

      if (hasAnyWalletExists) {
        // User has wallet on other network - check if it's unlocked
        const { unlocked } = await chrome.runtime.sendMessage({ type: "IS_UNLOCKED" })

        if (unlocked) {
          // Wallet is unlocked, go to setup to create wallet for this network
          setScreen("SetupWallet")
        } else {
          // Wallet exists but locked, show unlock screen
          setScreen("Unlock")
        }
      } else {
        // No wallet exists anywhere, go to setup
        setScreen("SetupWallet")
      }
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
            // Convert mnemonic to private key first
            const client = new window.vfx.VfxClient(network)
            const privateKey = client.privateKeyFromMneumonic(mnemonic, 0)
            const account = createAccountFromSecret(network, privateKey);

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
          currency={currency}
          account={account}
          onNetworkChange={handleNetworkChange}
          onCurrencyChange={async (newCurrency) => {
            setCurrency(newCurrency)

            if (newCurrency === Currency.BTC) {
              // Check if BTC wallet exists for current network
              const btcExists = await isWalletCreated(network, Currency.BTC)
              if (!btcExists) {
                setScreen("SetupBtc")
              }
              // If BTC wallet exists, stay on Home (it will load BTC data)
            }
            // VFX currency change doesn't need special handling - already loaded
          }}
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

      {screen === "SetupBtc" && (
        <SetupBtc
          network={network}
          onCreateFromVfx={async () => {
            try {
              // Get the current VFX account's private key
              if (!account?.private) {
                console.error("No VFX account available")
                return
              }

              // Create BTC keypair from VFX private key
              const btcKeypair = createBtcKeypairFromVfx(network, account.private)
              console.log("Created BTC keypair:", btcKeypair)
              console.log("VFX Private Key:", account.private)
              console.log("BTC Private Key:", btcKeypair.privateKey)
              console.log("BTC WIF:", btcKeypair.wif)

              // Get the current global password from background script
              const { mnemonic } = await chrome.runtime.sendMessage({ type: "GET_MNEMONIC" })
              if (!mnemonic) {
                alert("Wallet is locked. Please unlock first.")
                return
              }

              // Use the mnemonic as the password for encrypting BTC data
              // (This matches the existing VFX storage pattern)
              await encryptBtcKeypair(btcKeypair, mnemonic, network)

              // Success! Navigate back to home with BTC selected
              setCurrency(Currency.BTC)
              setScreen("Home")

            } catch (error) {
              console.error("Failed to create BTC wallet:", error)
              alert("Failed to create BTC wallet. Please try again.")
            }
          }}
          onImportPrivateKey={() => {
            // TODO: Implement BTC private key import
            console.log("Import BTC private key")
          }}
          onImportWif={() => {
            // TODO: Implement WIF import
            console.log("Import WIF")
          }}
        />
      )}
    </div>
  )
}

export default IndexPopup
