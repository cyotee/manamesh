# Reference Repositories

External repositories added as git submodules for research and comparison purposes. Each represents a different approach to on-chain poker.

---

## 1. poker-solidity (`dxganta/poker-solidity`)

**Approach:** Semi-decentralized Texas Hold'em with off-chain dealer trust

**Description:** A Brownie-based (Python) project that acknowledges the fundamental tension between blockchain transparency and poker privacy. Uses a trusted off-chain dealer to randomize and deal cards, while the smart contract handles betting, chip management, and winner determination. Card hashes are published on-chain; private keys revealed at showdown for verification.

**Tech Stack:** Solidity + Brownie + Ganache

**Key Contracts:**
- `Poker.sol` — Main game logic and betting
- `Evaluator7.sol` — 7-card hand evaluation (delegates to flush/noFlush tables)
- `flush/` — Lookup tables for flush hands (13 contracts)
- `noFlush/` — Lookup tables for non-flush hands (17 contracts)
- `DpTables.sol` — Duplicate poker hand tables

**Architecture:**
```
dealCards() → publishes card hashes (private keys sent off-chain)
showdown() → reveals private keys, verifies hashes, evaluates hands
```

**Limitations:** Requires trusted dealer for randomization (centralization). Uses Keccak256 hashing, not cryptographic commutative encryption.

**Status:** Untested/unaudited per author.

---

## 2. PokerWithFhe (`rafa-canseco/PokerWithFhe`)

**Approach:** FHE-based Texas Hold'em on Fhenix (optimistic rollup with FHE support)

**Description:** A Hardhat/TypeScript project implementing full Texas Hold'em where all game state (bets, cards, actions) remains encrypted during play via Fully Homomorphic Encryption. Fhenix allows the contract to compute on encrypted data without decrypting — eliminating the need for ZK proofs on every action.

**Tech Stack:** Solidity (Fhenix) + Hardhat + TypeScript

**Key Contracts:**
- `Poker.sol` — Main game contract (Fhenix FHE-enabled)
- `flush/Flush*.sol` — Flush hand evaluator tables
- `noFlush/NoFlush*.sol` — Non-flush hand evaluator tables (copies from poker-solidity)
- `Token.sol` — Wrapped ERC20 for encrypted bets
- `RandomMock.sol` — Placeholder for on-chain RNG
- `Ownable.sol`, `Context.sol` — Access control

**Architecture:**
```
Players provide FHE public keys
Contract deals encrypted cards (encrypts on-chain)
Bets stored as encrypted values
Actions (check/bet/call/fold) operate on encrypted state
Showdown decrypts all to determine winner
```

**Key Innovation:** No ZK proofs needed — FHE allows contract to compute on encrypted inputs directly. Players never submit decryption shares; the contract handles everything on-chain.

**Status:** Fhenix-specific implementation; tested on Fhenix testnet.

---

## 3. poker-fhe-base (`yayashuxue/poker-fhe-base`)

**Approach:** Minimal FHE poker on Base (alternative to Fhenix)

**Description:** The simplest FHE poker contract in this collection. Directly on Base Sepolia. Addresses the "Mental Poker problem" — that traditional approaches require players to submit ZK proofs on every shuffle/encrypt operation, degrading UX — by using FHE so the contract does all work without player burden.

**Tech Stack:** Solidity (Base) + FHE library

**Key Contracts:**
- `Poker.sol` — Main game logic (smaller, ~34KB)
- `Dealer.sol` — Encrypted deck management
- `IDealer.sol` — Dealer interface
- `PokerChip.sol` — Chip token handling
- `PokerHandEvaluator.sol` — Hand comparison
- `Counter.sol` — Simple counter (testing artifact)

**Architecture:**
```
Players' FHE public keys → contract encrypts cards on-chain
All game operations on encrypted data
Final reveal at showdown
```

**Deployed:** Sepolia Base at `0x312e64d300d4D9e2E528fde8a8fd1c4e1002e64E`

---

## 4. poker_contracts (`nyublockchainfintech/poker_contracts`)

**Approach:** Foundry-based poker with OpenZeppelin dependencies

**Description:** A minimal Foundry project with OpenZeppelin contracts and forge-std testing. Contains only a skeleton `Poker.sol` in `src/`. The value is in the dependency setup (OpenZeppelin + forge-std properly wired) rather than the game implementation itself.

**Tech Stack:** Solidity + Foundry + OpenZeppelin v5

**Key Contracts:**
- `src/Poker.sol` — Skeleton/placeholder contract

**Dependencies (recursive submodules):**
```
lib/forge-std/
lib/openzeppelin-contracts/
lib/openzeppelin-contracts/lib/erc4626-tests/
lib/openzeppelin-contracts/lib/forge-std/
```

**Use Case:** Reference for proper Foundry + OpenZeppelin project structure.

---

## 5. pok3r (`pok3rNetwork/pok3r`)

**Approach:** Full-stack P2P poker with video streaming (ambitious vision)

**Description:** The most ambitious project — a P2P multiplayer poker platform with video feeds, live streaming integration, and Web3 wallet login. Uses a hybrid architecture: V1 uses an off-chain backend for game state (trusting the server); V2 plans to move to on-chain with Chainlink VRF for RNG; V3 adds LivePeer streaming for spectating and betting.

**Tech Stack:** Hardhat + Node.js + WebRTC + LivePeer + IPFS + ENS + Polygon

**Key Components:**
- `blockchain/contracts/` — Solidity contracts
  - `pok3r.sol` — Main poker game logic
  - `pok3rVRF.sol` — Chainlink VRF integration for on-chain RNG
  - `pokernetworkcoin.sol` — ERC20 token for bets
  - `Vault/LobbyTracker.sol` — Lobby management
  - `Vault/DepositTracker.sol` — Deposit tracking
- `client/` — Frontend React app
- `api/` — Backend REST API
- `util/` — Utilities
- `bin/` — Binary scripts

**Roadmap Phases:**
| Version | Approach | Trust Model |
|---------|----------|-------------|
| V1 | Off-chain game state, on-chain escrow | Trusted server |
| V2 | On-chain game logic, Chainlink VRF | Trustless RNG |
| V3 | Live video streaming, audience betting | Decentralized |

**Innovations:** Live video feeds (WebRTC), IPFS replay storage, LivePeer streaming integration, ENS/Unstoppable Domains login.

**Status:** V1 in progress (per staging branch).

---

## Comparative Analysis

| Repo | Privacy Approach | On-Chain Cards | Deck Shuffle | Tech Stack | Status |
|------|-----------------|----------------|--------------|------------|--------|
| **poker-solidity** | Off-chain dealer | Hash commit only | Off-chain trusted | Brownie/Solidity | Untested |
| **PokerWithFhe** | FHE | Fully encrypted | On-chain FHE | Hardhat/Fhenix | Deployed |
| **poker-fhe-base** | FHE | Fully encrypted | On-chain FHE | Solidity/Base | Deployed |
| **poker_contracts** | Skeleton | — | — | Foundry/OZ | Scaffold only |
| **pok3r** | V1: Trusted server; V2+: VRF | V2: On-chain | V2: Chainlink VRF | Hardhat/Node | V1 WIP |

### Key Insight

All three FHE approaches (PokerWithFhe, poker-fhe-base) solve the same problem differently than ManaMesh's SRA mental poker:

| ManaMesh (SRA) | FHE Approaches |
|-----------------|----------------|
| Players encrypt/decrypt locally | Contract computes on encrypted data |
| Requires player cooperation for reveals | Contract handles everything atomically |
| No ZK proofs needed | No ZK proofs needed (FHE replaces them) |
| P2P (no server) | L3 or server-assisted |

**FHE is conceptually cleaner but requires FHE-enabled chains (Fhenix, certain L3s). SRA works on any EVM but requires multi-round player interaction.**

---

## Directory Structure

```
reference/
├── poker-solidity/         # Semi-decentralized (trusted dealer)
│   ├── contracts/
│   │   ├── Poker.sol
│   │   ├── Evaluator7.sol
│   │   ├── flush/          # Flush lookup tables
│   │   └── noFlush/        # Non-flush lookup tables
│   └── ...
├── PokerWithFhe/          # FHE on Fhenix
│   ├── contracts/
│   │   ├── Poker.sol
│   │   ├── Token.sol
│   │   ├── flush/
│   │   └── noFlush/
│   └── ...
├── poker-fhe-base/        # FHE on Base
│   ├── *.sol
│   └── ...
├── poker_contracts/       # Foundry + OZ scaffold
│   ├── src/
│   ├── lib/               # OpenZeppelin, forge-std
│   └── ...
└── pok3r/                # Full-stack P2P + video
    ├── blockchain/
    ├── client/
    ├── api/
    └── ...
```
