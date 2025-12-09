// Types for website authentication / key sharing

export interface KeyShareRequest {
  id: string
  origin: string
  timestamp: number
  tabId: number
}

export interface PendingKeyRequest extends KeyShareRequest {
  resolve?: (result: EncryptedKeyResponse) => void
}

export interface EncryptedKeyResponse {
  success: boolean
  salt?: number[]        // 16 bytes as array
  iv?: number[]          // 12 bytes as array
  cipherText?: number[]  // Encrypted private key as array
  address?: string       // VFX address
  publicKey?: string     // Public key hex
  error?: string
}

// Message types for key share communication
export enum KeyShareMessageType {
  // From inpage to content script
  VERIFIEDX_REQUEST_KEY = 'VERIFIEDX_REQUEST_KEY',

  // From content script to inpage
  VERIFIEDX_KEY_RESPONSE = 'VERIFIEDX_KEY_RESPONSE',

  // Background message types
  KEY_SHARE_REQUEST = 'KEY_SHARE_REQUEST',
  KEY_GET_PENDING_REQUEST = 'KEY_GET_PENDING_REQUEST',
  KEY_APPROVAL_RESULT = 'KEY_APPROVAL_RESULT',
}
