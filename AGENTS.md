# AGENTS.md

Agent-oriented reference for ManaMesh. This file explains the implemented game modules, their cryptographic methods, and the architectural patterns a new session needs to understand before modifying game code.

## Project Overview

ManaMesh is a decentralized, browser-based multiplayer platform for competitive card and board games. It prioritizes P2P networking so gameplay works without any server. Each game module demonstrates a different cryptographic paradigm for provably fair play between untrusted peers.

## Commands

```bash
# Development (from repo root)
yarn dev:frontend    # Vite dev server for frontend
yarn dev:backend     # nodemon + ts-node for backend

# Build & Test
yarn build           # Build all workspaces
yarn test            # Run Vitest tests (frontend)

# Single test file
yarn workspace @manamesh/frontend test src/game/logic.test.ts
```

## Architecture

### Monorepo Structure
- **packages/frontend**: React + Vite + boardgame.io + Phaser
- **packages/backend**: Node.js + Express + libp2p (optional signaling server)

### Frontend Key Directories
- `src/game/modules/` - Game module implementations (one subdirectory per game)
- `src/game/registry.ts` - Maps game IDs to `GameInfo<T>` entries with `getGame()` / `getCryptoGame()`
- `src/game/modules/types.ts` - Shared types: `GameModule`, `CoreCard`, `StandardCard`, `ZoneDefinition`
- `src/components/` - React board components (one per game)
- `src/crypto/` - All cryptographic primitives (see Crypto Primitives section)
- `src/p2p/` - P2P networking layer (WebRTC, join codes, libp2p discovery)
- `src/App.tsx` - Main app with lobby routing and game selection

### Common Architectural Patterns

- **HOST-authoritative moves**: All crypto game moves use `client: false` (executed on the boardgame.io host, not locally). This prevents clients from lying about game state.
- **GameModule interface**: Defined in `src/game/modules/types.ts`. Each module exports `id`, `cardSchema`, `zones`, `initialState`, `validateMove`, and `getBoardgameIOGame`.
- **Crypto setup phases**: All SRA-based card games follow the same setup progression: `keyExchange` -> `keyEscrow` -> `encrypt` -> `shuffle` -> (gameplay phases) -> `gameOver` or `voided`.
- **Setup player index**: Sequential setup steps (encrypt, shuffle) are gated by `setupPlayerIndex` which cycles through `playerOrder`. Only the current setup player can execute these moves.
- **Voided state**: All crypto games can enter a `voided` phase for unrecoverable failures (e.g., invalid proofs, failed signature verification).
- **Pure-HTML card rendering**: Board components render playing cards as styled `<div>` elements with Unicode suit symbols. Each board has a local `CardDisplay` component (not shared across games). Poker also supports IPFS asset pack images as an alternative.
- **Auto-setup effects**: Board components use `useEffect` hooks to automatically execute crypto setup moves (key exchange, encryption, shuffling) so the user does not need to manually trigger each step.

---

## Game Modules

### 1. Simple Card Game (`simple`)

**Purpose**: Baseline non-crypto game. No encryption, no fairness guarantees.

| File | Path |
|------|------|
| Game logic | `src/game/logic.ts` |
| boardgame.io wrapper | `src/game/game.ts` |
| Board component | `src/components/GameBoard.tsx` |

**How it works**: Draw cards, play cards. First to play 5 cards wins. Single phase, moves: `drawCard`, `playCard`. No crypto involved.

**Players**: 2

---

### 2. War (`war`)

**Purpose**: Demonstrates SRA commutative encryption + Shamir's Secret Sharing for key escrow and abandonment recovery.

| File | Path |
|------|------|
| Types | `src/game/modules/war/types.ts` |
| Standard game | `src/game/modules/war/game.ts` |
| Crypto game | `src/game/modules/war/crypto.ts` |
| Board component | `src/components/WarBoard.tsx` |

**Encryption**: SRA (Shamir-Rivest-Adleman) commutative encryption. Each player encrypts and shuffles the deck with their own key. Cards can only be decrypted when all encryption layers are removed, which requires cooperative decryption. Key escrow uses Shamir's Secret Sharing so if a player abandons, the remaining players can reconstruct their key after a threshold is met.

**Standard phases**: `flip` -> `resolve` -> `gameOver`

**Crypto phases**: `keyExchange` -> `keyEscrow` -> `encrypt` -> `shuffle` -> `flip` -> `reveal` -> `resolve` -> `gameOver` (or `voided`)

**Key moves**: `submitPublicKey`, `distributeKeyShares`, `encryptDeck`, `shuffleDeck`, `flipCard`, `approveDecrypt`, `releaseKey`, `surrender`

**How cooperative decryption works**: When a card needs to be revealed, a `DecryptRequest` is created. Each player approves the request by providing their decryption layer. Once all layers are removed, the plaintext card is revealed.

**Players**: 2

---

### 3. Texas Hold'em Poker (`poker`)

**Purpose**: Demonstrates full SRA mental poker with betting, hand evaluation, and blockchain settlement support.

| File | Path |
|------|------|
| Types | `src/game/modules/poker/types.ts` |
| Standard game | `src/game/modules/poker/game.ts` |
| Crypto game | `src/game/modules/poker/crypto.ts` |
| Hand evaluation | `src/game/modules/poker/hands.ts` |
| Betting logic | `src/game/modules/poker/betting.ts` |
| Board component | `src/components/PokerBoard.tsx` |

**Encryption**: Same SRA commutative encryption + Shamir's Secret Sharing as War, but applied to a full Texas Hold'em game with hole cards, community cards, and showdown reveals.

**Crypto phases**: `keyExchange` -> `keyEscrow` -> `encrypt` -> `shuffle` -> `preflop` -> `flop` -> `turn` -> `river` -> `showdown` -> `gameOver` (or `voided`)

**Key moves**: Same setup moves as War, plus `peekHoleCards` (self-decrypt dealt cards), `requestDecrypt` / `approveDecrypt` (cooperative reveal for community cards and showdown), `releaseKey` (on fold, proves valid cards), betting moves (`fold`, `check`, `call`, `bet`, `raise`, `allIn`).

**Hand evaluation**: `hands.ts` implements `evaluateHand`, `compareHands`, `findBestHand`, `determineWinners` with a `HandRank` enum from `HIGH_CARD` through `ROYAL_FLUSH`.

**Betting**: `betting.ts` implements `initBettingRound`, `processFold/Check/Call/Bet/Raise/AllIn`, `calculateSidePots`, blind posting, and dealer rotation.

**Blockchain settlement**: `buildHandResult` produces a `PokerHandResult` for on-chain settlement (contributions, starting chips, winner payouts).

**Card rendering**: `CardDisplay` supports both pure-HTML text cards and IPFS asset pack images, toggled via `useCardSettings` hook and `CardSettingsPanel` component.

**Players**: 2-6

---

### 4. Go Fish (3 Security Variants)

**Purpose**: Demonstrates three progressively stronger encryption modes using the same game engine. All three variants share one game engine in `src/game/modules/gofish/crypto.ts`, differentiated by `securityMode`.

| File | Path |
|------|------|
| Types | `src/game/modules/gofish/types.ts` |
| Shared crypto game engine | `src/game/modules/gofish/crypto.ts` |
| Board component | `src/components/GoFishBoard.tsx` |

#### Variant A: Demo-Private (`gofish`, securityMode=`demo-private`)

**What it demonstrates**: Basic mental poker encryption where private keys are stored in shared game state for transparency. This is intentionally insecure -- it shows how the protocol works but any player can read anyone's key. Use this to understand the encryption flow before looking at the secure variants.

**How cards are revealed**: The `peekHand` move takes a player's private key (read from shared state) and decrypts their hand zone in one step. Called "Instant Peek" in the UI.

#### Variant B: Coop Reveal (`gofish-secure`, securityMode=`coop-reveal`)

**What it demonstrates**: Cooperative decryption where private keys are never placed in shared state. To reveal any card, ALL players must submit a decryption share (their private key contribution for that card's encryption layers). No single player can unilaterally decrypt.

**How cards are revealed**: A `PendingReveal` is created specifying which zone/indices need revealing. Each player calls `submitDecryptionShare` providing their private key for that card. Once all shares are collected, the card is revealed. The UI shows a "Reveals needed" panel where each player clicks "Submit My Share".

**Key difference from demo-private**: During `keyEscrow`, the private key is NOT stored in shared state (empty string is submitted). All decryption is cooperative.

#### Variant C: ZK Attest (`gofish-zk`, securityMode=`zk-attest`)

**What it demonstrates**: Zero-knowledge proof scaffolding with verifier-signed verdicts. Instead of revealing cards directly, the acting player submits a ZK proof envelope. A designated verifier checks the proof off-chain, then signs a verdict (valid/invalid) using ECDSA. The signed verdict is submitted as a move and all players verify the signature on-chain.

**How it works**:
1. Acting player calls `submitZkProofRespondToAsk` or `submitZkProofClaimBooks` with a `ZkProofEnvelope` (vkeyId, publicSignals, proof) and a payload describing the claimed action.
2. A `PendingZkCheck` is created with a `payloadHash` binding the proof to the match's deterministic seed (`matchSalt`).
3. The designated verifier (player 0) checks the proof off-chain, then calls `submitZkVerdict` with verdict (`valid`/`invalid`) and an ECDSA signature over `{pendingId, matchSalt, payloadHash, verdict}`.
4. The move verifies the signature against the verifier's registered `zkSigPublicKey`.

**ZK types**: `ZkProofEnvelope`, `PendingZkCheck` (with `id`, `purpose`, `submittedBy`, `envelope`, `payload`, `verifier`, `payloadHash`, `verdict`, `verdictSig`).

**Note**: The actual ZK circuits are not yet implemented -- the current code uses placeholder proofs. The infrastructure (signing, verification, payload hashing) is fully wired.

#### Shared Go Fish Mechanics (all 3 variants)

**Crypto phases**: `keyExchange` -> `keyEscrow` -> `encrypt` -> `shuffle` -> `play` -> `gameOver` (or `voided`)

**Deterministic shuffle**: The shuffle phase has a multi-party commit-reveal seed sub-protocol. ALL players participate simultaneously (unlike encrypt/shuffle which are sequential per `setupPlayerIndex`):
1. **Commit phase**: Each player commits `SHA256(seedHex)` via `commitShuffleSeed`.
2. **Reveal phase**: Each player reveals their `seedHex` via `revealShuffleSeed`. The game verifies `SHA256(revealed) == committed`.
3. **Ready**: `finalSeedHex` is derived by XORing all revealed seeds. This seeds a deterministic Fisher-Yates shuffle.

**Stall recovery**: If the shuffle phase stalls (no progress for `GOFISH_SHUFFLE_STALL_WINDOW_MOVES = 12` moves), players can call `voteAbortShuffle`. A majority vote voids the game.

**Gameplay moves**: `peekHand` (demo only), `askRank`, `respondToAsk`, `goFish` (draw from deck), `claimBooks` (claim 4-of-a-kind).

**Forced Go Fish**: When a player must draw (no matching cards from ask target), `awaitingGoFishFor` locks the game until they draw. In coop-reveal mode, `awaitingGoFishDrawCardKey` triggers cooperative decryption of the drawn card.

**Card rendering**: Pure-HTML playing cards. Face-up cards for the current player's peeked hand (sorted by rank), face-down card backs for other players' hands.

**Players**: 2-4

---

### 5. Merkle Battleship (`merkle-battleship`)

**Purpose**: Demonstrates cryptographic commitment schemes (Merkle trees) for verifiable board placement without revealing positions upfront.

| File | Path |
|------|------|
| Types | `src/game/modules/merkle-battleship/types.ts` |
| Game | `src/game/modules/merkle-battleship/game.ts` |
| Commitment helpers | `src/game/modules/merkle-battleship/commitment.ts` |
| Board component | `src/components/MerkleBattleshipBoard.tsx` |

**Encryption**: SHA-256 Merkle tree commitments. Each player commits to a 10x10 board (100 cells). Each cell's leaf hash is `SHA256(utf8("${gameId}|${playerId}|${cellIndex}|${bit}|") || saltBytes)` where `bit` is 0 (water) or 1 (ship). The Merkle root is published as `commitmentRootHex`.

**Phases**: `placement` -> `battle` -> `gameOver`

**How verification works**: On each guess, the opponent reveals the cell value with a Merkle proof (sibling hashes along the path to the root). The `applyReveal` move recomputes the leaf hash from the revealed value + salt and verifies the Merkle proof against the committed root. This proves the opponent cannot change ship positions after the game starts.

**Standard fleet**: Carrier(5), Battleship(4), Cruiser(3), Submarine(3), Destroyer(2) = 17 total ship cells.

**Win condition**: `hasAllShipsSunkFromMarks` -- all 17 ship cells marked as hits.

**Players**: 2

---

### 6. HE Battleship (Homomorphic Encryption Demo)

**Purpose**: Demonstrates Paillier additively homomorphic encryption for encrypted aggregate commitments.

| File | Path |
|------|------|
| Types | `src/game/modules/he-battleship/types.ts` |
| Game | `src/game/modules/he-battleship/game.ts` |
| Logic | `src/game/modules/he-battleship/logic.ts` |
| Board component | `src/components/HEBattleshipBoard.tsx` |

**Encryption**: Paillier homomorphic encryption. Each player encrypts their board cells individually, then the encrypted values can be summed homomorphically to verify total ship counts without revealing positions.

**Phases**: `placement` -> `battle` -> `gameOver`

**Placement moves**: `setBoardBits`, `publishPublicKey` (Paillier `n`), `publishHomomorphicCommitment`

**Current status**: This is a demo/scaffolding. The battle phase currently reads the opponent's `boardBits` directly (trusted mode), not via cryptographic verification. The Paillier commitment demonstrates that encrypted ship counts can be aggregated homomorphically -- the verification path is not yet wired into gameplay.

**Registry**: Not in registry (component-only demo, accessed via direct import).

**Players**: 2

---

### 7. Threshold Tally Arena (`threshold-tally`)

**Purpose**: Demonstrates threshold homomorphic encryption where individual inputs stay private but the aggregate total is decryptable. Uses Feldman DKG for distributed key generation and EC ElGamal for encryption.

| File | Path |
|------|------|
| Types | `src/game/modules/threshold-tally/types.ts` |
| Game | `src/game/modules/threshold-tally/game.ts` |
| Logic | `src/game/modules/threshold-tally/logic.ts` |
| Board component | `src/components/ThresholdTallyBoard.tsx` |

**Encryption**: Feldman DKG (Distributed Key Generation) over secp256k1 + EC ElGamal with message-in-exponent encoding + DLEQ (Chaum-Pedersen) proofs for verifiable partial decryption.

**Phases**: `setup` -> `commit` -> `decrypt` -> `resolve` (cycles back to `commit` for new rounds)

**Setup (DKG)**:
1. `publishDkgCommitment` - Each player publishes Feldman commitments (polynomial coefficients * G).
2. `confirmDkgShare` - Players confirm receipt of secret shares.
3. `publishPublicShare` - Players publish their public key shares.
4. `finalizeDkg` - Derives combined public key from verified shares.

**Commit**: `submitCiphertext` - Each player encrypts their input value using EC ElGamal with message-in-exponent encoding. The game auto-aggregates via `elgamalAdd` when all ciphertexts are submitted.

**Decrypt**: `submitDecryptShare` - Players provide partial decryptions with DLEQ proofs. The game verifies each proof, then combines partials via Lagrange interpolation (`elgamalCombinePartials`). Threshold is `t=2`, meaning any 2 of the players can decrypt the aggregate.

**Resolve**: `ackRoundResult` - Players acknowledge the result; game cycles back to commit for next round.

**Key types**: `SecpPointHex`, `SecpScalarHex`, `DkgCommitment`, `ElGamalCiphertext` ({c1, c2}), `DleqProof`, `ThresholdTallyConfig` (min/maxContribution, baseTarget).

**Players**: 2-3

---

## Three Cryptographic Paradigms

The games demonstrate three distinct approaches to provably fair P2P play:

1. **Mental Poker (SRA commutative encryption)** - For card games requiring hidden shuffled decks. Players jointly encrypt and shuffle, then cooperatively decrypt individual cards. Each player adds their own encryption layer; cards can only be read when all layers are removed. Used by: War, Poker, Go Fish.

2. **Commitment Schemes (Merkle tree / hash commitments)** - For board games requiring binding placement. Players commit to board state upfront by publishing a Merkle root, then reveal cells with Merkle proofs during gameplay. The commitment prevents changing placements after the game starts. Used by: Merkle Battleship.

3. **Threshold Homomorphic Encryption** - For aggregation scenarios where individual values must stay private. Players encrypt inputs under a jointly-generated public key; only the aggregate sum is decryptable, and decryption requires a threshold of participants to cooperate. Used by: Threshold Tally Arena, HE Battleship (demo).

---

## Crypto Primitives

All primitives live in `src/crypto/` and are re-exported from `src/crypto/index.ts`:

| Primitive | File | Used By |
|-----------|------|---------|
| SRA commutative encryption | `mental-poker/` | War, Poker, Go Fish |
| Shamir's Secret Sharing | `shamirs.ts` | War, Poker, Go Fish (key escrow) |
| SHA-256 | `sha256.ts` | All crypto games |
| Merkle tree | `merkle.ts` | Merkle Battleship |
| Stable JSON serialization | `stable-json.ts` | Go Fish ZK payload hashing |
| secp256k1 curve ops | `secp256k1.ts` | Threshold Tally, Go Fish ZK sigs |
| EC ElGamal (exp encoding) | `ec-elgamal-exp.ts` | Threshold Tally |
| Feldman DKG | `feldman-dkg.ts` | Threshold Tally |
| DLEQ proofs | `dleq.ts` | Threshold Tally |
| ECDSA | `ecdsa.ts` | Go Fish ZK verdict signing |
| Paillier HE | `paillier.ts` | HE Battleship |
| boardgame.io crypto plugin | `plugin/` | War, Poker, Go Fish (CryptoPluginState) |

---

## Known Issues / Development Notes

- `crypto.test.ts` has a pre-existing import issue with `boardgame.io/core` (ESM resolution). Tests that don't import boardgame.io work fine.
- Type-check (`tsc --noEmit`) has pre-existing errors in third-party packages only. Application code is clean.
- Vite build succeeds cleanly.
- HE Battleship is not registered in the game registry -- it's a standalone component demo.
- Go Fish ZK circuits are placeholder scaffolding -- the signing/verification infrastructure is wired but actual ZK proofs are not yet generated.
- The shuffle phase commit-reveal steps must NOT be gated behind `isMySetupTurn` in the board auto-setup effect. Only the sequential `shuffleDeck` call should be gated. This was a previous deadlock bug.

## Tech Stack
- **Frontend**: React, boardgame.io (turn-based logic), Phaser 3 (rendering), TypeScript
- **P2P/Storage**: libp2p, helia (IPFS), WebTorrent, IndexedDB (offline cache)
- **Backend**: Express, libp2p, OrbitDB
- **Crypto (fairness)**: elliptic (mental poker), circomlibjs (ZKPs), paillier-bigint (HE)
- **Testing**: Vitest
