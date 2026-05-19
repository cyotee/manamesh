# ManaMesh Project Status — May 8, 2026

## Executive Summary

ManaMesh is a decentralized P2P card game platform with strong cryptographic primitives for provably fair play. The infrastructure (asset loading, P2P networking, crypto primitives) is solid. Game completeness varies — **War** and **Merkle Battleship** are fully playable end-to-end. **OnePiece** is the most complete game module (crypto + gameplay + Phaser board all wired) with cooperative decryption working. **Blockchain settlement** (MM-035) has been implemented with EIP-712 signing for bet escrow.

**Security review (May 8):** The cryptographic remediation pass fixed all critical primitive-level issues (fake SHA-256, private key leakage, EC encoding mismatch, biased randomness, unencrypted Shamir shares). Two **protocol-level gaps remain critical for untrusted P2P**: player identity is not bound to the move sender in War/Poker/Go Fish decryption moves, and decryption share validation was only applied to Go Fish — War and Poker are still missing it. See [Security Status](#security-status) and `SECURITY_REPORT.md` for the full breakdown.

---

## Build & Test Health

| Check | Status | Details |
|-------|--------|---------|
| Vite Build | ✅ Clean | 8,842 kB output (gzip: 2,375 kB) |
| TypeScript | ✅ Clean | App code clean, third-party package errors only |
| Tests | ✅ 1126 passing | 62 test files, 0 skipped |

---

## Security Status

> Full details in `SECURITY_REPORT.md`. This section summarizes blockers for untrusted P2P deployment.

### Remediation Complete ✅

| # | Issue | Fix Applied |
|---|---|---|
| V1 | Fake SHA-256 (LCG) in `hashToPoint` | Real SHA-256 from `sha256.ts` |
| V2 | Private keys stored in shared game state | `demo-private` paths throw unconditionally |
| V3 (partial) | Decryption share validation | Fixed in Go Fish only |
| V9 | EC point encoding mismatch | All points normalized via `secpPointNormalizeHex` |
| V10 | Shamir shares transmitted unencrypted | ECIES (AES-256-GCM + HMAC-SHA-256) in `shamirs/split.ts` |
| V11 | `Math.random()` for request/hand IDs | Replaced with `crypto.randomUUID()` in War and Poker |
| V12 | DLEQ proofs not enforced (Threshold Tally) | Verified on every partial decrypt; assertion rejects on failure |
| V13 | Biased random sampling (modulo) | Rejection sampling in `shuffle-proof.ts` and `shamirs/split.ts` |
| V14 | Feldman DKG degree-1 only (library) | Library now supports arbitrary threshold t |
| V15 | `Math.random()` in shuffle paths | Fixed in crypto shuffle paths |

### Critical — P2P Blockers 🔴

| # | Issue | Location | Fix |
|---|---|---|---|
| R1 | War and Poker accept unvalidated curve points in decryption shares; Poker `submitDecryptedShare` is a no-op stub | `war/crypto.ts:819`, `poker/crypto.ts:887,1084` | Add `secpIsValidPointHex` guard; implement Poker stub |
| R2 | `playerId` in decryption moves is caller-supplied, never compared to `ctx.playerID` — any peer can impersonate any player | `war/crypto.ts:780`, `gofish/crypto.ts:1488`, `poker/crypto.ts:856` | `if (playerId !== ctx.playerID) return INVALID_MOVE` |

### Important 🟡

| # | Issue | Location | Fix |
|---|---|---|---|
| R3 | No stall timeout for reveal phase — refusing peer stalls game indefinitely | All SRA modules | Add move-count void trigger for reveal phase |
| R4 | No `authenticateCredentials` — any peer can connect as any player ID | All game definitions | Implement boardgame.io auth or P2P token validation |
| R5 | Go Fish defaults to disabled `demo-private` mode — `decryptToCardId` throws at runtime | `gofish/crypto.ts:444` | Change default to `"coop-reveal"` |
| R6 | `Date.now()` in OnePiece move handlers breaks boardgame.io deterministic replay | `onepiece/game.ts:471,840,876` | Use `ctx.turn`/`ctx.numMoves` for IDs |

### Low / Deferred 🔵

- `Math.random()` in OnePiece pre-crypto `shuffleDeck` (R7 — low impact, overwritten by crypto phases)
- Threshold Tally hard-codes t=2 in usage despite library supporting arbitrary t (R8)
- No replay protection on decryption operations (R9)
- Commit-and-reveal shuffle is not true ZK — permutation leaks post-game (R10)
- Go Fish `zk-attest` mode is scaffolding — no Circom circuits (R11, deferred)
- HE Battleship reads opponent board directly in battle phase (R12)
- No DoS protection for Merkle Battleship reveals (R13)

---

## Game Modules

### Fully Functional (End-to-End Playable)

| Module | Status | Notes |
|--------|--------|-------|
| **War** | ⚠️ Playable / P2P unsafe | 56 tests, SRA crypto, cooperative decryption, full flip/resolve/gameOver — R1 + R2 open |
| **Merkle Battleship** | ✅ Complete | Merkle tree commitments, reveal verification, 5-ship fleet |
| **Threshold Tally** | ✅ Complete | Feldman DKG, EC ElGamal, DLEQ proofs enforced, threshold decryption, multi-round |
| **Simple** | ✅ Baseline | Draw/play, 5-card win condition, no crypto |

### Standard (No Crypto) — Complete

| Module | Status | Notes |
|--------|--------|-------|
| **Poker** (standard) | ✅ Complete | Betting, hand evaluation, showdown, side pots |

### Cryptographically Scaffolded — Gameplay Incomplete

| Module | Crypto | Gameplay | Security Notes |
|--------|--------|----------|-------|
| **OnePiece** | ✅ SRA | ⚠️ Core done | Phaser board complete, cooperative decryption working; R6 (Date.now() in moves) |
| **Poker** (crypto) | ⚠️ Incomplete | ❌ Missing | `submitDecryptedShare` is no-op stub (R1); betting not wired to crypto phases |
| **Go Fish** (coop-reveal) | ✅ Coop decrypt | ❌ Missing | R2 open; R5 default mode bug |
| **Go Fish** (zk-attest) | ✅ ECDSA scaffold | ❌ Missing | ZK circuits are placeholders; do not expose to users |
| **Go Fish** (demo-private) | ❌ Disabled | ❌ Missing | Unconditionally throws — intentionally broken for security |

### Demo/Proof-of-Concept

| Module | Status | Notes |
|--------|--------|-------|
| **HE Battleship** | ⚠️ Demo | Paillier HE scaffolding; battle phase reads opponent board directly (R12) |

---

## OnePiece Module

### Current Completeness by Layer

| Layer | Status | Details |
|-------|--------|---------|
| Types & Zones | ✅ Complete | 7 zones, full card types, 6-state visibility machine, slot types |
| Deck Resolution | ✅ Complete | `deckResolver.ts` handles DeckList → OnePieceCard[] + multi-pack |
| State Management | ✅ Complete | `deckLoaded`, `leaderLife`, `deckCardIds`, `lifeDeckIds` tracking |
| Phase Wiring | ✅ Complete | `setup → keyExchange → encrypt → shuffle → play → gameOver/voided` |
| Turn Structure | ✅ Complete | Draw/main/end stages, auto-draw, DON!! refresh, `endIf` on life=0 |
| Win Condition | ✅ Complete | `takeLifeDamage` → `leaderLife` → `G.winner` + `phase="gameOver"` |
| SRA Crypto | ✅ Complete | keyExchange, encrypt, shuffle, cooperative decrypt |
| Start & Deal | ✅ Complete | "One Piece can start and deal" (6e589f7) |
| Phaser Board | ✅ Complete | leaderLife display, DON!! indicators, phase strip, crypto auto-setup |
| Proof Chain | ✅ Complete | SHA-256 via `sha256Hex`, ECDSA via `ecdsaSignDigestHex` |
| P2P Wiring | ✅ Complete | `useAssetSharing` integrated; deck sharing + missing card requests |
| Tests | ✅ 261 passing | Full module test suite |

### Remaining Items

1. **R6 — Deterministic DON card IDs** — `Date.now()` in move handlers (`game.ts:471,840,876`) breaks boardgame.io replay; replace with `ctx.turn`/`ctx.numMoves`
2. **TakeLifeDamage overlay** — Life deck reveal preview / decrypt animation UI
3. **Win/Lose modal** — Animated game-over overlay with winner announcement
4. **Integration tests** — Full E2E from deck load → crypto setup → gameplay

---

## Smart Contracts (MM-035 — Complete)

| File | Status | Details |
|------|--------|---------|
| `GameVault.sol` | ✅ Complete | Bet settlement escrow vault |
| `ChipToken.sol` | ✅ Complete | ERC20 chip token |
| `ChipTokenFactory.sol` | ✅ Complete | Factory for chip tokens |
| **EIP-712 Signing** | ✅ Complete | Bet settlement with EIP-712 wallet signatures |
| Forge tests | ⚠️ Unknown | Not verified with `forge test` |

---

## Infrastructure

### Asset Loading — ✅ Solid

- **3-tier fallback**: IndexedDB Cache → Helia (browser IPFS) → HTTP Gateway
- **Two cache layers**: general `assets/cache.ts` (~100MB LRU) + pack-level `assets/loader/cache.ts`
- **Source types**: `ipfs | ipfs-zip | http | local | p2p`
- **Known issue**: `ipfs-loader.ts` has verbose `console.log` debug statements

### P2P Networking — ✅ Functional

- libp2p + WebRTC, 4 transport modes (LAN/mDNS, Direct IP, Circuit Relay, Join Code)
- Transport settings persist in `localStorage`, overridable via URL params
- All transports work without centralized STUN servers

### P2P Asset Sharing — ✅ Wired

- Protocol in `p2p/asset-sharing.ts` with 8 message types
- `AssetSharingSession` + `useAssetSharing` hook integrated into `OnePiecePhaserBoard`
- Deck list sharing + missing card requests flow end-to-end

### Cryptographic Primitives — ✅ Comprehensive

| Primitive | Location | Used By |
|-----------|----------|---------|
| SRA commutative encryption | `crypto/mental-poker/` | War, Poker, Go Fish, OnePiece |
| Commit-reveal shuffle | `crypto/mental-poker/shuffle-proof.ts` | War, Go Fish, OnePiece |
| Cooperative decryption | pattern in each crypto module | War, Go Fish, OnePiece |
| Merkle tree | `crypto/merkle.ts` | Merkle Battleship |
| EC ElGamal | `crypto/ec-elgamal-exp.ts` | Threshold Tally |
| Feldman DKG (arbitrary t) | `crypto/feldman-dkg.ts` | Threshold Tally |
| DLEQ proofs | `crypto/dleq.ts` | Threshold Tally |
| ECDSA | `crypto/ecdsa.ts` | OnePiece proof chain, Go Fish ZK |
| Shamir SSS (ECIES-encrypted) | `crypto/shamirs/` | Key escrow (not in active games) |
| Paillier HE | `crypto/paillier.ts` | HE Battleship |
| SHA-256 (sync) | `crypto/sha256.ts` | All crypto games |
| Stable JSON | `crypto/stable-json.ts` | Go Fish ZK payload hashing |

### boardgame.io Integration — ✅ Complete

- All game modules export `getBoardgameIOGame()`
- `client: false` on all crypto moves prevents optimistic update attacks
- OnePiece registry entry has `getCryptoGame: () => OnePieceCryptoGame`
- ⚠️ No `authenticateCredentials` configured on any game (R4)

### Deck Builder — ✅ Functional

- Validation (50-card main, 10-card DON, 1 leader, max 4 copies)
- Stats: cost curve, color/type breakdown, counter values
- YAML/TOML import/export
- IndexedDB persistence via `idb-keyval`
- Bracket-text keyword highlighting (15 OnePiece TCG keywords)
- Multi-pack support with card image routing via `cardPackMap`

---

## Architecture Patterns

### 1. Mental Poker — SRA Commutative Encryption

**Used by:** War, Poker (crypto), Go Fish (all variants), OnePiece

**Problem:** How do two to five players shuffle and deal cards without a trusted dealer, so neither can cheat or peek?

**How it works:**

```
Shared deck of encrypted cards
         ↓
Player 0 adds encryption layer  → E₀(deck)
         ↓
Player 1 adds encryption layer  → E₁(E₀(deck))  ← neither player can read this alone
         ↓
Both players shuffle their encrypted layers
         ↓
Deal a card: Player 1 decrypts their layer, sends it → E₀(card)
                               Player 0 decrypts their layer → card revealed
```

**Key property:** Encryption is *commutative* — `E₀(E₁(x)) = E₁(E₀(x))`. Cards can only be revealed when **all** players cooperatively decrypt. Abandonment voids the hand — no key escrow or recovery.

**Current P2P gaps:** R1 (curve point validation missing in War/Poker), R2 (move sender not verified), R3 (no stall timeout).

**Flow:**
```
keyExchange → encrypt → shuffle → play → gameOver
     ↓           ↓         ↓
   Public     SRA       Commit-
   key        encrypt   reveal
   exchange             shuffle
```

---

### 2. Commitment Schemes — Merkle Trees

**Used by:** Merkle Battleship

**Problem:** How does a player commit to ship placements *before* the opponent can see them, without being able to change them later?

**How it works:**

```
Each cell: leaf = SHA256("${gameId}|${playerId}|${cellIndex}|${bit}|${salt}")
All 100 leaves → Merkle root → published to shared state
         ↓
Attack a cell → Defender reveals: bit (0/1) + salt + Merkle proof (sibling hashes)
         ↓
Verifier: recompute leaf + verify proof against committed root
```

**Key property:** The root is *binding* — after publishing, the defender cannot change their board. Each reveal proves *only* the targeted cell.

**Flow:**
```
placement (commit Merkle root) → battle (reveal cell + Merkle proof) → gameOver
```

---

### 3. Threshold Homomorphic Encryption

**Used by:** Threshold Tally, HE Battleship

**Problem:** How do multiple players submit private inputs and only reveal the *aggregate* sum?

**How it works:**

```
Setup: Feldman DKG — players jointly generate a shared public key
         ↓
Each player encrypts their input: Enc(m₁), Enc(m₂), Enc(m₃)
         ↓
Ciphertexts aggregate homomorphically:
         Enc(m₁) ⊕ Enc(m₂) ⊕ Enc(m₃) = Enc(m₁ + m₂ + m₃)
         ↓
Threshold players submit partial decryptions + DLEQ proofs
Lagrange interpolation reconstructs the total — individual inputs stay hidden
```

**Current status:** DLEQ proofs enforced in Threshold Tally on every partial. HE Battleship does not use the HE layer in its battle phase (R12).

**Flow:**
```
setup (Feldman DKG) → commit (EC ElGamal) → decrypt (DLEQ + Lagrange) → resolve
```

---

## Distance to Intended Feature Set

**Original vision**: Decentralized platform for MTG, OnePiece, Lorcana with P2P networking, IPFS assets, provably fair crypto, blockchain settlement.

| Component | Completeness | Notes |
|-----------|--------------|-------|
| P2P Networking | ~90% | |
| IPFS Asset Loading | ~85% | |
| Cryptographic Primitives | ~95% | Primitives sound; protocol gaps R1/R2 remain |
| Deck Builder | ~90% | |
| War | ~85% | Playable; R1+R2 open for P2P |
| Merkle Battleship | 100% | |
| Threshold Tally | 100% | |
| Simple | 100% | |
| OnePiece | ~80% | R6 (Date.now()), UI polish remaining |
| Poker (standard) | 100% | |
| Poker (crypto) | ~40% | R1 (stub), betting not wired |
| Go Fish (all variants) | ~40% | R2+R5 open; no game rules |
| HE Battleship | ~30% | |
| Blockchain Settlement | ~50% | |
| MTG/Lorcana modules | 0% | |

**Overall: ~55–65% toward the full vision.**

---

## Critical Gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| R1 — Curve point validation in War/Poker | **Critical** | Malicious peer can corrupt game state silently |
| R2 — Move sender identity not verified | **Critical** | Any peer can impersonate any player's decryption |
| R4 — No game-layer authentication | High | Any peer can connect as any player ID |
| R3 — No reveal-phase stall timeout | High | Refusing peer stalls game indefinitely |
| R5 — Go Fish default mode bug | Medium | Runtime exception in `demo-private` default |
| R6 — `Date.now()` in OnePiece moves | Medium | Breaks boardgame.io deterministic replay |
| Poker crypto + betting integration | High | Crypto phases exist; betting not wired |
| Go Fish game rules | High | Crypto scaffolding complete; no actual game rules |
| HE Battleship verification (R12) | Medium | Reads opponent board directly |
| OnePiece polish | Medium | TakeLifeDamage overlay, win/lose modal |
| Forge contract tests | Medium | Contracts exist; `forge test` not verified |
| ZK circuits (R11) | Low | Infrastructure wired; no Circom circuits |
| MongoDB backend | Low | Backend has no database code despite docs mentioning it |

---

## Recent Commits

| Commit | Description |
|--------|-------------|
| `8b96b1f` | feat: fixed cooperative decryption |
| `6e589f7` | wip: One Piece can start and deal |
| `cfc8a08` | chore: create MM-043..MM-046 from MM-035 review suggestions |
| `51a8365` | chore: mark MM-035 complete, archive task files |
| `a3e029a` | feat(MM-035): bet settlement escrow vault with EIP-712 signing |

---

## Multi-Page IPFS Deployment

Games are segmented into separate deployable pages with shared code extracted into reusable chunks.

### Build Output

```
dist/src/pages/
├── war/index.html              → 0.63 kB game JS
├── poker/index.html            → 0.63 kB game JS
├── onepiece/index.html         → 0.71 kB game JS
├── gofish/index.html           → 0.64 kB game JS
├── simple/index.html           → 0.63 kB game JS
├── merkle-battleship/index.html → 0.65 kB game JS
├── threshold-tally/index.html   → 0.64 kB game JS
└── dev-console/index.html     → 98 kB (full menu + all boards)

Shared chunks (preloaded, cached independently):
├── manamesh-crypto   → 121 kB (SRA, Merkle, EC, DKG, SHA-256, etc.)
├── manamesh-p2p      → 53 kB (libp2p, WebRTC, transports)
├── manamesh-assets   → 153 kB (Helia, IPFS loader, IndexedDB cache)
├── manamesh-deck     → 72 kB (deck utilities, validation)
├── vendor-bgio       → 139 kB (boardgame.io)
├── vendor-libp2p     → 1,058 kB (libp2p runtime)
├── vendor-helia      → 324 kB (IPFS browser node)
├── vendor-crypto-libs → 133 kB (elliptic, paillier)
└── vendor-web3       → 3,015 kB (wagmi, viem, RainbowKit)
```

### Per-Game Page Architecture

Each game page (`src/pages/<game>/`) is a minimal React app:
- Imports the game's board component and bgio game definition
- Renders `<Client game={...} board={...} multiplayer={Local()} />`
- Zero references to App.tsx or GameSelector
- Shares all heavy code via preloaded shared chunks

### Dev Console (`dev-console`)

The dev console is the full menu/launcher (App.tsx) as a standalone page. Served at `dist/src/pages/dev-console/index.html` after build.

### Deployment

```bash
yarn build  # produces dist/src/pages/<game>/index.html + shared assets/
```

Each HTML loads its tiny game JS + preloads shared chunks. Shared chunks get stable CIDs on IPFS and are pinned once. Game pages are updated independently.

---

_Last updated: May 8, 2026 — post security review. 1126 tests passing. Critical P2P blockers: R1 (curve point validation in War/Poker), R2 (identity binding in decryption moves). See `SECURITY_REPORT.md` for full findings._
