# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Plasmo-based browser extension for the VerifiedX (VFX) network with Bitcoin (BTC) support. It's a multi-currency cryptocurrency wallet extension that supports both mainnet and testnet networks for both currencies, providing wallet creation, import, transaction signing, and balance viewing functionality.

**Supported Currencies:**
- **VFX (VerifiedX)** - Mainnet and Testnet
- **BTC (Bitcoin)** - Mainnet and Testnet4 (via mempool API)

## Development Commands

### Build and Development
- `pnpm dev` or `npm run dev` - Start development server
- `pnpm build` or `npm run build` - Create production build
- `pnpm package` or `plasmo package` - Package extension for store submission

### Loading Extension for Development
Load the development build from `build/chrome-mv3-dev` in your browser's extension developer mode.

## Architecture

### Core Components

**Main Entry Points:**
- `popup.tsx` - Main popup UI with state machine for different screens (SetupWallet, Unlock, Home, etc.)
- `background.ts` - Service worker handling wallet unlock state and mnemonic storage in memory
- `content.ts` - Content script (minimal, currently empty)

**Key Directories:**
- `popup/pages/` - Individual screen components (SetupWallet, Home, Unlock, etc.)
- `lib/` - Core utilities and components
  - `secureStorage.ts` - Encryption/decryption of private keys using Web Crypto API
  - `utils.ts` - Wallet utilities and account creation
  - `components/` - Reusable UI components
- `types/` - TypeScript type definitions
- `assets/` - Static assets including VFX JavaScript library

### State Management

The extension uses a screen-based state machine in `popup.tsx` with states:
- `Booting` - Initial loading state
- `SetupWallet` - Wallet creation/import flow
- `BackupMnemonic` - Mnemonic backup confirmation
- `Unlock` - Password entry to decrypt wallet
- `Home` - Main wallet interface
- `RecoverMnemonic` - Mnemonic recovery flow
- `ImportPrivateKey` - Private key import flow

### Security Architecture

- **Background Memory**: Decrypted mnemonic stored temporarily in service worker memory (5-minute timeout)
- **Persistent Storage**: Encrypted private keys stored using Plasmo Storage with PBKDF2 + AES-GCM
- **Network Separation**: Separate encrypted storage per network (mainnet/testnet)
- **Auto-lock**: Automatic wallet locking after 5 minutes of inactivity

### External Dependencies

- **VFX Library**: Loaded via `assets/vfx.js`, provides `window.vfx.VfxClient` for VFX blockchain interactions
- **BTC Library**: Loaded via `assets/btc.js`, provides `window.btc` with Bitcoin functionality:
  - `window.btc.KeypairService` - Bitcoin keypair generation and management
  - `window.btc.TransactionService` - Bitcoin transaction creation and broadcasting
  - `window.btc.AccountService` - Bitcoin account info and balance retrieval
  - `window.btc.BtcClient` - Main Bitcoin client with mempool API integration
- **Plasmo Storage**: For secure persistent storage
- **Chrome Extension APIs**: For background messaging and storage

### Network Support

The extension supports switching between:
- `Network.Mainnet` - Production VFX network
- `Network.Testnet` - Development/testing VFX network

Each network maintains separate wallet storage and requires separate wallet setup.

## Common Development Patterns

### Adding New Screens
1. Create component in `popup/pages/`
2. Add screen state to `popup.tsx` state machine
3. Implement navigation logic in main popup component

### Wallet Operations
- Use `lib/secureStorage.ts` for encryption/decryption
- Use `lib/utils.ts` for account creation and VFX client interactions
- Always check network context when performing operations

### Background Communication
Use Chrome messaging API to communicate with background script:
```typescript
const response = await chrome.runtime.sendMessage({ type: "MESSAGE_TYPE" })
```

Available message types: `UNLOCK_WALLET`, `IS_UNLOCKED`, `GET_MNEMONIC`, `LOCK_WALLET`, `RESET_UNLOCK_TIMER`

## BTC Integration Architecture

### Currency and Network Structure
The extension will support a matrix of Currency × Network combinations:
- **VFX-Mainnet**, **VFX-Testnet** (existing)
- **BTC-Mainnet**, **BTC-Testnet4** (new)

### BTC Wallet Creation Methods
1. **Derived from VFX Key**: Uses VFX private key → email/password format → deterministic BTC keypair
   - Ensures cross-platform compatibility with web wallet
   - Algorithm: `VFXPrivateKey → emailPasswordFormat → keypairFromEmailPassword()`
2. **Import WIF**: Direct import of Bitcoin WIF (Wallet Import Format)
3. **Import Private Key**: Direct import of Bitcoin private key hex

### BTC Address Types
The BTC client supports multiple address formats via `IBtcAddresses`:
- **p2pkh**: Legacy addresses (1...)
- **p2sh**: Nested SegWit (3...)
- **bech32**: Native SegWit (bc1...)
- **bech32m**: Taproot addresses (bc1p...)

### BTC Client Interface
```typescript
window.btc.BtcClient.generateEmailKeypair(email, password, index?)
window.btc.KeypairService.keypairFromMnemonic(mnemonic)
window.btc.TransactionService.createTransaction(...)
window.btc.AccountService.getAccountInfo(address)
```

### Storage Architecture Changes
Current: `encryptedPrivateKey_${network}`
Planned: `encryptedPrivateKey_${currency}_${network}`

This enables separate encrypted storage for each currency-network combination.

### UX Flow Changes
- **Home Screen**: Add segmented control [VFX] [BTC] with currency-specific theming
- **Initial BTC Setup**: Lazy-loaded when user first switches to BTC tab
- **Import Options**: WIF, Private Key, or Derive from VFX key

## Implementation Status

### ✅ Completed Features

**BTC Key Generation & Storage:**
- VFX-to-BTC key derivation using email/password algorithm
- Cross-platform compatibility with web wallet confirmed
- Currency-specific encrypted storage: `${currency}-${network}-wallet`
- BTC keypair storage with both WIF and full keypair data

**UI & Display:**
- Currency segmented control (centered, auto-sizing)
- Dynamic balance display (VFX in gray, BTC in orange, satoshi conversion)
- Dynamic address display (VFX or BTC address based on currency)
- Currency-specific button theming (blue for VFX, orange for BTC)
- Loading states for both currencies

**Data Management:**
- Currency-aware data fetching (VFX via VfxClient, BTC via BtcClient)
- Background mnemonic integration for BTC wallet encryption
- Network-aware BTC client initialization (mainnet/testnet)
- Automatic currency state persistence

### 🔧 Key Functions Added

```typescript
// Storage functions
encryptBtcKeypair(keypair: IBtcKeypair, password: string, network: Network)
decryptBtcKeypair(password: string, network: Network): Promise<IBtcKeypair>
isWalletCreated(network: Network, currency: Currency)

// Utility functions
createBtcKeypairFromVfx(network: Network, vfxPrivateKey: string): IBtcKeypair
```

### 📁 Storage Architecture
```
vfx-mainnet-wallet: VFX mainnet private key
vfx-testnet-wallet: VFX testnet private key
btc-mainnet-wallet: BTC mainnet WIF
btc-testnet-wallet: BTC testnet WIF
btc-mainnet-keypair: BTC mainnet full keypair
btc-testnet-keypair: BTC testnet full keypair
```