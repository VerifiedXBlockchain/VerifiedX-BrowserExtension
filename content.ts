// Content script - Bridge between webpage and extension background
// Injects provider script and relays messages

import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_start"
}

// Inject the provider script into the page context using external file
function injectProvider() {
  try {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('assets/inpage.js')
    script.onload = function() {
      script.remove()
    }
    ;(document.head || document.documentElement).appendChild(script)
  } catch (error) {
    console.error('VerifiedX: Failed to inject provider', error)
  }
}

// Inject as early as possible
injectProvider()

// Store current origin for validation
const currentOrigin = window.location.origin

// Listen for messages from the inpage script
window.addEventListener('message', async (event) => {
  // Only accept messages from our window
  if (event.source !== window) return

  const { type, requestId } = event.data || {}

  if (type === 'VERIFIEDX_PROVIDER_REQUEST') {
    relayProviderRequest(requestId, event.data.method, event.data.params)
    return
  }

  // Only handle our message types
  if (type !== 'VERIFIEDX_REQUEST_KEY') return

  try {
    // Relay to background script
    const response = await chrome.runtime.sendMessage({
      type: 'KEY_SHARE_REQUEST',
      origin: currentOrigin,
      requestId
    })

    // Send response back to inpage script
    window.postMessage({
      type: 'VERIFIEDX_KEY_RESPONSE',
      requestId,
      payload: response
    }, '*')
  } catch (error) {
    console.error('VerifiedX content script error:', error)
    window.postMessage({
      type: 'VERIFIEDX_KEY_RESPONSE',
      requestId,
      payload: { success: false, error: 'Extension error' }
    }, '*')
  }
})

// Provider requests (window.verifiedX.request). Only the method name and
// params are forwarded; the background works out the origin itself.
async function relayProviderRequest(requestId: unknown, method: unknown, params: unknown) {
  if (typeof requestId !== 'string') return
  let payload: unknown
  try {
    payload = await chrome.runtime.sendMessage({
      type: 'PROVIDER_REQUEST',
      method: typeof method === 'string' ? method : null,
      params: params === undefined ? null : params
    })
  } catch (error) {
    console.error('VerifiedX content script error:', error)
    payload = { ok: false, error: { code: -32603, message: 'Extension error' } }
  }
  window.postMessage({ type: 'VERIFIEDX_PROVIDER_RESPONSE', requestId, payload }, '*')
}
