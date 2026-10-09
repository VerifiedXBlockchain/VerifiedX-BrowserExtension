(function() {
  if (window.verifiedX) return; // Already injected

  // Errors from request() carry a numeric code (see the extension README).
  function providerError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  // Slightly longer than the extension's own request lifetime, so the
  // extension's answer (including "expired") normally arrives first.
  const REQUEST_TIMEOUT_MS = 7 * 60 * 1000;

  class VerifiedXProvider {
    constructor() {
      this.isInstalled = true;
      this._ready = false;
      this._pendingRequests = new Map();
      this._providerRequests = new Map();

      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const { type, requestId, payload } = event.data || {};

        if (type === 'VERIFIEDX_PROVIDER_RESPONSE') {
          const pending = this._providerRequests.get(requestId);
          if (!pending) return;
          this._providerRequests.delete(requestId);
          if (payload && payload.ok) {
            pending.resolve(payload.result);
          } else {
            const error = (payload && payload.error) || {};
            pending.reject(providerError(error.code || -32603, error.message || 'Request failed'));
          }
          return;
        }

        if (type === 'VERIFIEDX_KEY_RESPONSE') {
          const pending = this._pendingRequests.get(requestId);
          if (pending) {
            if (payload.success) {
              pending.resolve({
                salt: payload.salt,
                iv: payload.iv,
                cipherText: payload.cipherText,
                address: payload.address,
                publicKey: payload.publicKey,
              });
            } else {
              pending.reject(new Error(payload.error || 'Request failed'));
            }
            this._pendingRequests.delete(requestId);
          }
        }
      });

      this._ready = true;
    }

    _generateRequestId() {
      return Date.now() + '-' + Math.random().toString(36).substring(2, 11);
    }

    requestKey() {
      const requestId = this._generateRequestId();

      return new Promise((resolve, reject) => {
        this._pendingRequests.set(requestId, { resolve, reject });

        window.postMessage({
          type: 'VERIFIEDX_REQUEST_KEY',
          requestId,
          payload: {}
        }, '*');

        // Timeout after 5 minutes
        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('Key request timed out'));
          }
        }, 5 * 60 * 1000);
      });
    }

    // Generic entry point: request({ method, params }).
    request(args) {
      const method = args && args.method;
      const params = args && args.params;
      if (typeof method !== 'string') {
        return Promise.reject(providerError(-32602, 'request() needs a method name'));
      }
      const requestId = this._generateRequestId();

      return new Promise((resolve, reject) => {
        this._providerRequests.set(requestId, { resolve, reject });
        window.postMessage({ type: 'VERIFIEDX_PROVIDER_REQUEST', requestId, method, params }, '*');

        setTimeout(() => {
          if (this._providerRequests.has(requestId)) {
            this._providerRequests.delete(requestId);
            reject(providerError(4300, 'Request timed out'));
          }
        }, REQUEST_TIMEOUT_MS);
      });
    }

    connect() {
      return this.request({ method: 'vfx_connect' });
    }

    getAccounts() {
      return this.request({ method: 'vfx_getAccounts' });
    }

    disconnect() {
      return this.request({ method: 'vfx_disconnect' });
    }

    signMessage(message) {
      return this.request({ method: 'vfx_signMessage', params: { message } });
    }

    signTransaction(transaction) {
      return this.request({ method: 'vfx_signTransaction', params: transaction });
    }

    sendTransaction(transaction) {
      return this.request({ method: 'vfx_sendTransaction', params: transaction });
    }

    isReady() {
      return this._ready;
    }
  }

  window.verifiedX = new VerifiedXProvider();
  window.dispatchEvent(new CustomEvent('verifiedX#initialized'));
})();
