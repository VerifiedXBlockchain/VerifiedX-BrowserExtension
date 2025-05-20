import { useEffect, useState } from "react"
import "./style.css"
import cube from 'data-base64:~assets/vfx-cube.png'
import wordmark from 'data-base64:~assets/wordmark.png'
import SetupWallet from "~popup/pages/SetupWallet"
import BackupMnemonic from "~popup/pages/BackupMnemonic"
import { isWalletCreated } from "~lib/secureStorage"
import Home from "~popup/pages/Home"
import Unlock from "~popup/pages/Unlock"
import { Network, type Account } from "~types/types"
import "assets/vfx.js"
import { mnemonicToAccount } from "~lib/utils"

function IndexPopup() {
  const [network, setNetwork] = useState<Network>(Network.Testnet)
  const [mnemonic, setMnemonic] = useState("")
  const [account, setAccount] = useState<Account | null>(null)
  const [screen, setScreen] = useState<"Booting" | "SetupWallet" | "BackupMnemonic" | "Unlock" | "Home">("Booting")

  useEffect(() => {
    const init = async () => {
      const hasWallet = await isWalletCreated()

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

        const account = mnemonicToAccount(network, mnemonic, 0);

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


  if (screen == "Booting") {
    return <div className="bg-gray-950 w-96 min-h-56 text-white"></div>

  }

  return (
    <div className="bg-gray-950 w-96 text-white">
      {screen !== "Home" && (
        <div className="flex justify-center items-center flex-col pt-4">
          <img src={cube} width={64} height={64} />
          <div className="pt-1" />
          <img src={wordmark} width={100} />
        </div>)}


      {screen === "SetupWallet" && (
        <SetupWallet
          network={network}
          onCreate={(createdMnemonic) => {
            setMnemonic(createdMnemonic)
            setScreen("BackupMnemonic")
          }}
        />
      )}

      {screen === "BackupMnemonic" && (
        <BackupMnemonic
          network={network}
          mnemonic={mnemonic}
          onConfirm={() => {
            const account = mnemonicToAccount(network, mnemonic, 0);



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
          onLock={async () => {
            await chrome.runtime.sendMessage({ type: "LOCK_WALLET" })
            setAccount(null)
            setScreen("Unlock")
          }}
        />
      )}
    </div>
  )
}

export default IndexPopup
