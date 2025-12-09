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
