import { useState, useEffect } from "react"
import { Network, type Account } from "~types/types"
import type { KeyShareRequest } from "~types/auth"
import { encryptKeyForExport } from "~lib/keyEncryption"

interface ApproveKeyShareProps {
  network: Network
  account: Account
  onComplete: () => void
}

export default function ApproveKeyShare({ network, account, onComplete }: ApproveKeyShareProps) {
  const [request, setRequest] = useState<KeyShareRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    // Fetch pending request from background
    const fetchRequest = async () => {
      const response = await chrome.runtime.sendMessage({
        type: 'KEY_GET_PENDING_REQUEST'
      })
      setRequest(response.request)
      setLoading(false)
    }
    fetchRequest()
  }, [])

  const handleApprove = async () => {
    if (!request) return
    if (!password.trim()) {
      setError("Password is required")
      return
    }

    setProcessing(true)
    setError("")

    try {
      // Encrypt the private key with the user's password
      const encryptedData = await encryptKeyForExport(account.private, password)

      // Send approval with encrypted data
      await chrome.runtime.sendMessage({
        type: 'KEY_APPROVAL_RESULT',
        requestId: request.id,
        approved: true,
        encryptedData: {
          ...encryptedData,
          address: account.address,
          publicKey: account.public
        }
      })

      // Close the popup window
      window.close()
    } catch (err) {
      console.error('Encryption error:', err)
      setError("Failed to encrypt key. Please try again.")
      setProcessing(false)
    }
  }

  const handleDeny = async () => {
    if (!request) return
    setProcessing(true)

    await chrome.runtime.sendMessage({
      type: 'KEY_APPROVAL_RESULT',
      requestId: request.id,
      approved: false
    })

    window.close()
  }

  if (loading) {
    return (
      <div className="flex flex-col p-6 text-white items-center justify-center min-h-56">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="flex flex-col p-6 text-white">
        <p className="text-center text-gray-400">No pending requests</p>
        <button
          onClick={() => window.close()}
          className="mt-4 bg-gray-700 hover:bg-gray-600 p-3 rounded font-semibold"
        >
          Close
        </button>
      </div>
    )
  }

  const formatOrigin = (origin: string) => {
    try {
      const url = new URL(origin)
      return url.hostname
    } catch {
      return origin
    }
  }

  return (
    <div className="flex flex-col p-6 text-white space-y-4">
      {/* Header */}
      <h1 className="text-xl font-light text-center">
        Key Share Request
      </h1>

      {/* Origin Badge */}
      <div className="bg-gray-800 rounded-lg p-4">
        <p className="text-xs text-gray-400 mb-1">Requesting site:</p>
        <p className="text-lg font-mono break-all">{formatOrigin(request.origin)}</p>
        <p className="text-xs text-gray-500 mt-1 break-all">{request.origin}</p>
      </div>

      {/* Warning */}
      <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-3">
        <p className="text-sm text-red-400 font-semibold mb-1">⚠️ Security Warning</p>
        <p className="text-xs text-red-300">
          This will share your <strong>encrypted private key</strong> with this website.
          Once decrypted, they can create transactions without further approval.
          Only proceed if you fully trust this website.
        </p>
      </div>

      {/* Account Info */}
      <div className="bg-gray-800 rounded-lg p-4">
        <p className="text-xs text-gray-400 mb-1">Your VFX address:</p>
        <p className="text-sm font-mono break-all">{account.address}</p>
      </div>

      {/* Password Input */}
      <div className="bg-gray-800 rounded-lg p-4">
        <label className="text-xs text-gray-400 mb-2 block">
          Enter password to encrypt your key:
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError("")
          }}
          placeholder="Your wallet password"
          className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          disabled={processing}
        />
        {error && (
          <p className="text-xs text-red-400 mt-2">{error}</p>
        )}
        <p className="text-xs text-gray-500 mt-2">
          The website will need this same password to decrypt your key.
        </p>
      </div>

      {/* Actions */}
      <div className="flex space-x-3 pt-2">
        <button
          onClick={handleDeny}
          disabled={processing}
          className="flex-1 bg-gray-700 hover:bg-gray-600 p-3 rounded font-semibold disabled:opacity-50"
        >
          Deny
        </button>
        <button
          onClick={handleApprove}
          disabled={processing || !password.trim()}
          className="flex-1 bg-blue-600 hover:bg-blue-500 p-3 rounded font-semibold disabled:opacity-50"
        >
          {processing ? 'Encrypting...' : 'Approve'}
        </button>
      </div>
    </div>
  )
}
