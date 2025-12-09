(function() {
  if (window.verifiedX) return; // Already injected

  class VerifiedXProvider {
    constructor() {
      this.isInstalled = true;
      this._ready = false;
      this._pendingRequests = new Map();

      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const { type, requestId, payload } = event.data || {};

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

    isReady() {
      return this._ready;
    }
  }

  window.verifiedX = new VerifiedXProvider();
  window.dispatchEvent(new CustomEvent('verifiedX#initialized'));
})();
