# Task MM-034: Ethereum Wallet Integration

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-31
**Dependencies:** MM-029
**Worktree:** `feature/ethereum-wallet`

---

## Description

Implement reusable Ethereum wallet integration for all crypto-enabled game modules. This extracts the shared wallet functionality (connect, sign, derive keys, EIP-712 signing) from MM-031 into a standalone module that any game can use. Provides both a React context provider for UI and a boardgame.io plugin for game state integration.

## Dependencies

- MM-029: Cryptographic Deck Plugin (Mental Poker) - for key derivation integration

## User Stories

### US-MM-034.1: Wallet Connection

As a player, I want to connect my Ethereum wallet so that my identity is tied to my blockchain address.

**Acceptance Criteria:**
- [ ] Use wagmi + RainbowKit for wallet management
- [ ] Support MetaMask, WalletConnect, Coinbase Wallet, Rainbow, and injected wallets
- [ ] WalletProvider React context wraps the app
- [ ] `useWallet()` hook provides: address, isConnected, connect(), disconnect()
- [ ] Connection state persists across page refreshes
- [ ] Clean disconnect clears all state
- [ ] Tests cover connection flow

### US-MM-034.2: Multi-Chain Support

As a player, I want to use the wallet on different networks so that I can play on my preferred chain.

**Acceptance Criteria:**
- [ ] Support: Ethereum Mainnet, Sepolia, Arbitrum, Base, Optimism, Polygon
- [ ] Chain configuration via environment variables
- [ ] `useChain()` hook provides: chainId, chain, switchChain()
- [ ] Auto-prompt to switch chain when needed
- [ ] Display chain name/icon in UI components
- [ ] Tests cover chain switching

### US-MM-034.3: Game Key Derivation

As a player, I want my game keys derived from my wallet so that the same wallet always produces the same keys for a given game.

**Acceptance Criteria:**
- [ ] `deriveGameKeys(gameId)` returns deterministic keys from wallet signature
- [ ] Message format: `ManaMesh Game Key\nGame ID: {gameId}\nVersion: 1`
- [ ] Keys derived using keccak256(signature) as seed
- [ ] Integration with CryptoPlugin's `createPlayerCryptoContextFromWallet()`
- [ ] Same wallet + gameId always produces same keys
- [ ] Tests verify determinism

### US-MM-034.4: EIP-712 Typed Data Signing

As a game, I want players to sign structured actions so that game events are verifiable on-chain.

**Acceptance Criteria:**
- [ ] Define EIP-712 domain for ManaMesh games
- [ ] Define typed data schemas for common game actions:
  - GameAction (generic action wrapper)
  - JoinGame
  - CommitShuffle
  - RevealCard
  - SubmitResult
- [ ] `signTypedData(type, data)` utility function
- [ ] `verifyTypedSignature(type, data, signature, address)` utility
- [ ] Action signatures are chain-agnostic (can verify on any chain)
- [ ] Tests cover signing and verification

### US-MM-034.5: Wallet boardgame.io Plugin

As a game developer, I want wallet state accessible in boardgame.io moves so that games can access player addresses and signing.

**Acceptance Criteria:**
- [ ] `WalletPlugin` follows boardgame.io plugin pattern
- [ ] Plugin state includes: playerAddresses, playerPublicKeys, signatures
- [ ] API includes: `getPlayerAddress()`, `signAction()`, `verifyAction()`
- [ ] Integration with CryptoPlugin for key management
- [ ] Plugin state serializable for P2P transport
- [ ] Tests cover plugin API

### US-MM-034.6: Wallet UI Components

As a frontend developer, I want pre-built wallet UI components so that I can quickly add wallet features to game UIs.

**Acceptance Criteria:**
- [ ] `<ConnectButton />` - RainbowKit-styled connect button
- [ ] `<AccountDisplay />` - Shows address, ENS name, avatar
- [ ] `<ChainSelector />` - Dropdown for chain switching
- [ ] `<WalletModal />` - Full wallet management modal
- [ ] Components follow existing UI patterns (Tailwind/CSS modules)
- [ ] Storybook stories for each component

## Technical Details

### Wallet Stack

```
wagmi v2 + RainbowKit v2
├── @rainbow-me/rainbowkit
├── wagmi
├── viem
└── @tanstack/react-query (peer dependency)
```

### Chain Configuration

```typescript
const chains = {
  mainnet: { id: 1, name: 'Ethereum', ... },
  sepolia: { id: 11155111, name: 'Sepolia', ... },
  arbitrum: { id: 42161, name: 'Arbitrum One', ... },
  base: { id: 8453, name: 'Base', ... },
  optimism: { id: 10, name: 'Optimism', ... },
  polygon: { id: 137, name: 'Polygon', ... },
};
```

### Key Derivation Flow

```typescript
async function deriveGameKeys(gameId: string): Promise<CryptoKeyPair> {
  const message = `ManaMesh Game Key\nGame ID: ${gameId}\nVersion: 1`;
  const signature = await signMessage({ message });
  const seed = keccak256(signature);

  // Use elliptic to generate keys from seed
  const ec = new EC('secp256k1');
  const keyPair = ec.keyFromPrivate(seed.slice(2));

  return {
    privateKey: keyPair.getPrivate('hex'),
    publicKey: keyPair.getPublic('hex')
  };
}
```

### EIP-712 Domain

```typescript
const MANAMESH_DOMAIN = {
  name: 'ManaMesh',
  version: '1',
  // chainId is dynamic based on connected chain
};

// Example typed data for game action
const GameActionType = {
  GameAction: [
    { name: 'gameId', type: 'string' },
    { name: 'actionIndex', type: 'uint256' },
    { name: 'actionType', type: 'string' },
    { name: 'data', type: 'bytes' },
    { name: 'previousHash', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
  ],
};
```

### WalletPlugin Interface

```typescript
interface WalletPluginState {
  playerAddresses: Record<string, string>; // playerId -> address
  playerPublicKeys: Record<string, string>; // playerId -> publicKey
  actionSignatures: SignedAction[];
}

interface WalletPluginApi {
  registerPlayer: (playerId: string, address: string, publicKey: string) => void;
  getPlayerAddress: (playerId: string) => string | null;
  signAction: (playerId: string, action: GameAction) => Promise<SignedAction>;
  verifyAction: (signedAction: SignedAction) => boolean;
  getSignedActions: () => SignedAction[];
}
```

## Files to Create

**Wallet Core:**
- `packages/frontend/src/wallet/provider.tsx` - WalletProvider with wagmi/RainbowKit setup
- `packages/frontend/src/wallet/config.ts` - Chain configuration
- `packages/frontend/src/wallet/hooks/useWallet.ts` - Main wallet hook
- `packages/frontend/src/wallet/hooks/useChain.ts` - Chain management hook
- `packages/frontend/src/wallet/hooks/useGameKeys.ts` - Key derivation hook

**Signing:**
- `packages/frontend/src/wallet/signing/domain.ts` - EIP-712 domain config
- `packages/frontend/src/wallet/signing/types.ts` - Typed data schemas
- `packages/frontend/src/wallet/signing/sign.ts` - Signing utilities
- `packages/frontend/src/wallet/signing/verify.ts` - Verification utilities

**boardgame.io Plugin:**
- `packages/frontend/src/wallet/plugin/wallet-plugin.ts` - WalletPlugin
- `packages/frontend/src/wallet/plugin/wallet-plugin.test.ts` - Tests

**UI Components:**
- `packages/frontend/src/wallet/components/ConnectButton.tsx`
- `packages/frontend/src/wallet/components/AccountDisplay.tsx`
- `packages/frontend/src/wallet/components/ChainSelector.tsx`
- `packages/frontend/src/wallet/components/WalletModal.tsx`

**Modified:**
- `packages/frontend/src/crypto/plugin/crypto-plugin.ts` - Integration with WalletPlugin
- `packages/frontend/src/App.tsx` - Wrap with WalletProvider
- `packages/frontend/package.json` - Add wagmi, viem, rainbowkit dependencies

**Tests:**
- `packages/frontend/src/wallet/hooks/*.test.ts`
- `packages/frontend/src/wallet/signing/*.test.ts`

## Inventory Check

Before starting, verify:
- [ ] MM-029 CryptoPlugin is complete and working
- [ ] Node.js environment supports wagmi v2
- [ ] Test networks (Sepolia) accessible

## Completion Criteria

- [ ] All acceptance criteria met for all 6 user stories
- [ ] Wallet connects with MetaMask and WalletConnect
- [ ] Multi-chain switching works for all supported chains
- [ ] Game key derivation is deterministic
- [ ] EIP-712 signing and verification works
- [ ] WalletPlugin integrates with boardgame.io
- [ ] UI components render correctly
- [ ] Tests pass (minimum 80% coverage)
- [ ] Build succeeds
- [ ] No TypeScript errors

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
