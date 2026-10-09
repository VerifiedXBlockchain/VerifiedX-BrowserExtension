This is a [Plasmo extension](https://docs.plasmo.com/) project bootstrapped with [`plasmo init`](https://www.npmjs.com/package/plasmo).

## Provider API

The extension injects `window.verifiedX` into every http(s) page. A site asks for an account or a signature; the user approves each request in an extension popup; the extension signs with the key it holds and returns only the result. Sites never receive key material.

Types for everything below are in [`types/verifiedx-provider.d.ts`](types/verifiedx-provider.d.ts).

### Detecting the extension

```js
function whenVerifiedX(callback) {
  if (window.verifiedX) return callback(window.verifiedX)
  window.addEventListener("verifiedX#initialized", () => callback(window.verifiedX), { once: true })
}
```

### Methods

Every method is available as `window.verifiedX.request({ method, params })` and as a shortcut.

| Method | Shortcut | Popup | Returns |
|---|---|---|---|
| `vfx_connect` | `connect()` | Yes, unless the site is already connected and the wallet is unlocked | `[{ address, publicKey, network }]` |
| `vfx_getAccounts` | `getAccounts()` | No | The connected account, or `[]` if the site is not connected or the wallet is locked |
| `vfx_disconnect` | `disconnect()` | No | `true`; the site must connect again |
| `vfx_signMessage` | `signMessage(message)` | Yes | `{ message, signedMessage, signature, address, publicKey }` |
| `vfx_signTransaction` | `signTransaction(tx)` | Yes | `{ hash, transaction }`, signed and not sent |
| `vfx_sendTransaction` | `sendTransaction(tx)` | Yes | `{ hash, status }`, where `status` is `"sent"` or `"unknown"` |

Signing methods need a connected site. A connection lasts until the site calls `disconnect()` or the wallet is removed from the extension. It covers both networks, and the site sees the account for the network the extension is on.

#### Messages

`signMessage` signs this exact text, which the popup shows in full:

```
VerifiedX Signed Message:
Origin: <the requesting site's origin>

<message>
```

The prefix keeps a signed message from ever matching a transaction hash. The origin ties the signature to the site that asked for it. To verify, check `signature` against `signedMessage` and the account's public key. The signature is SHA-256 over the text, ECDSA secp256k1, in the network's format `base64(DER).base58(publicKey)`. A node's `/raw/validate-signature/` endpoint accepts it as well.

#### Transactions

```js
const { hash, status } = await window.verifiedX.sendTransaction({
  to: "xAbc...",       // recipient (or feature target such as "Token_Base")
  amount: "1.5",       // VFX, decimal string preferred
  type: 0,             // optional, vfx-web-sdk TxType; default 0 (transfer)
  data: null,          // optional, as the node expects for the type
  network: "testnet"   // optional; refused with 4901 if the extension is on the other network
})
```

The site supplies only these fields. The extension gets the timestamp, nonce, fee and hash from the network itself, shows the type, recipient, amount, fee, total and data in the popup, and signs the hash it built. Any hash or signature the page passes in is ignored.

`signTransaction` returns the signed transaction in the node's format for the site to broadcast. It can be sent at any time, so prefer `sendTransaction` unless the site has to submit the transaction itself.

When `sendTransaction` returns `status: "unknown"`, the transaction was dispatched but the network's reply was lost. It may still confirm. Look `hash` up on chain before sending again. The extension refuses new sends from the wallet until that transaction confirms or expires.

### Errors

Rejected promises carry `error.code`:

| Code | Meaning |
|---|---|
| 4001 | The user rejected the request or closed the popup |
| 4100 | The site is not connected (call `vfx_connect` first) |
| 4200 | Unsupported method |
| 4300 | The request expired (5 minutes without an answer) |
| 4901 | The request names a network the extension is not on |
| -32002 | This site already has a request waiting for approval |
| -32602 | Invalid parameters |
| -32603 | Internal error; for example, the network refused the transaction before it was sent |

Each site can have one request waiting at a time. Each popup is bound to one request and shows the requesting origin as reported by the browser.

### Bitcoin

The provider does not sign Bitcoin transactions yet.

## Getting Started

First, run the development server:

```bash
pnpm dev
# or
npm run dev
```

Open your browser and load the appropriate development build. For example, if you are developing for the chrome browser, using manifest v3, use: `build/chrome-mv3-dev`.

You can start editing the popup by modifying `popup.tsx`. It should auto-update as you make changes. To add an options page, simply add a `options.tsx` file to the root of the project, with a react component default exported. Likewise to add a content page, add a `content.ts` file to the root of the project, importing some module and do some logic, then reload the extension on your browser.

For further guidance, [visit our Documentation](https://docs.plasmo.com/)

## Making production build

Run the following:

```bash
pnpm build
# or
npm run build
```

This should create a production bundle for your extension, ready to be zipped and published to the stores.

## Submit to the webstores

The easiest way to deploy your Plasmo extension is to use the built-in [bpp](https://bpp.browser.market) GitHub action. Prior to using this action however, make sure to build your extension and upload the first version to the store to establish the basic credentials. Then, simply follow [this setup instruction](https://docs.plasmo.com/framework/workflows/submit) and you should be on your way for automated submission!
