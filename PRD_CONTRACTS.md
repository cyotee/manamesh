**Poker Hand Settlement Smart Contracts – Product Requirements Document (PRD)**

**Version:** 1.1  
**Date:** May 19, 2026  
**Authors:** Grok (xAI) + not_cyotee (ManaMesh team)  
**Status:** Final – Ready for implementation agent hand-off  

> **v1.1 note:** Original PRD body preserved below for context. The authoritative
> implementation decisions live in §11 (Addendum: Locked Implementation Decisions).
> Where §11 conflicts with the original body, §11 wins.

### 1. Purpose
Build a **minimal, production-ready, gas-optimized settlement layer** for Texas Hold’em poker that runs on top of the existing ManaMesh off-chain stack (boardgame.io + libp2p + mental poker with cooperative elliptic encryption/decryption).

The on-chain contracts act **only** as a trustless escrow + verifiable settlement engine. All game logic, shuffling, dealing, betting rounds, and card evaluation remain 100 % off-chain. The design guarantees:
- Unanimous cryptographic consent before any hand starts.
- Exact pot accounting based on actual bets placed (not just buy-ins).
- Full protection against player abandonment or refusal to sign.
- No player-to-player splitting of forfeited funds (all go to vault + rake).
- Minimal on-chain transactions (2–9 membership assertions + 1 settlement per hand).
- Works on any EVM L2 today and Ethereum mainnet tomorrow.

### 2. Scope
**In scope**
- Per-token ERC20 vaults (deposit / withdraw / accounting).
- Deterministic off-chain handId generation.
- Hand registration via unanimous off-chain signatures + per-player on-chain assertions.
- Off-chain signed betting round states.
- Normal settlement (full signatures) and force-timeout settlement (partial signatures after timeout).
- Full settlement overrides force-timeout at any time.
- Pending-hand lock to prevent new joins or withdrawals until settled.
- Configurable rake sent to operator address.
- Basic Level-1 on-chain poker hand verification stub (optional for POC).

**Out of scope**
- UI / frontend changes.
- Full poker engine (already exists in ManaMesh).
- ZK proofs or Chainlink VRF integration (future extensions – hooks provided).
- ERC-721 NFTs, tournaments, or side-pots (can be added later).

### 3. Assumptions & Dependencies
- Target chain: EVM L2 (Base/Arbitrum/Optimism/etc.) with Ethereum mainnet compatibility.
- Players connect via wallets (EIP-712 signatures).
- Off-chain: ManaMesh boardgame.io module + libp2p for P2P message exchange.
- Each player maintains a simple persistent `playerHandNonce` (uint256, localStorage or client state).
- ERC20 tokens approved to the settler contract before deposit.
- Operator address receives rake (configurable at deployment).

### 4. Player Lifecycle (High-Level Flow)

1. Deposit → vault (any ERC20 token).
2. P2P discovery / lobby formation (2–9 players).
3. Off-chain HandInit signing (players, buyIns, vault, config, nonces).
4. Each player submits `assertHandMembership` on-chain (locks buy-in).
5. Last assertion activates hand → mental-poker play begins.
6. Off-chain betting (signed RoundStateTransitions).
7. Showdown → cooperative decryption → HandOutcome signing.
8. Settlement (normal or force-timeout) → payouts to vault balances.
9. Repeat or withdraw unused vault balance.

### 5. Core Data Structures (Abstract)

**HandInit** (EIP-712 typed data – signed by every player)
- players[] (sorted addresses)
- buyIns[] (parallel, each ≤ vault balance)
- vault (ERC20 address – all players must match)
- smallBlind, bigBlind, timeoutSeconds, otherConfig
- playerHandNonces[] (parallel, each player’s monotonic counter)

**handId** = `keccak256(abi.encode(HandInit fields))` – fully deterministic, off-chain, bytes32, collision-free.

**RoundStateTransition** (EIP-712 – signed per betting round)
- handId
- roundNumber (0=pre-flop … 3=river)
- currentPot
- playerStacks[] (sorted by address)
- actionHash

**HandOutcome** (EIP-712 – signed at showdown)
- handId
- pot
- winners[]
- payouts[] (sums exactly to pot)
- finalStacks[] (parallel – proves exact bets placed)
- finalStateHash (commitment to revealed cards + all prior commitments)

### 6. On-Chain Contract Interface (PokerHandSettler.sol)

**Core functions**
- `deposit(token, amount)` – adds to player’s vault balance.
- `assertHandMembership(handId, HandInit, signatures[])` – each player’s membership assertion. Last caller activates hand and locks buy-ins.
- `settleHand(handId, HandOutcome, signatures[])` – full unanimous settlement (anytime).
- `forceTimeoutSettlement(handId, HandOutcome, partialSignatures[], lastRoundState)` – partial after timeout; forfeited amounts + rake → vault.
- `withdraw(token, amount)` – only if no pending hands.
- `timeoutPlayer(handId, player)` – optional early warning (does not settle).

**Key invariants enforced on-chain**
- Full settlement always overrides any pending force-timeout.
- Payouts + finalStacks must balance against initial buy-ins.
- Rake % taken from pot on every settlement (forfeited or normal) and sent to operator.
- Pending-hand list prevents new joins or withdrawals until settled.

### 7. Off-Chain Requirements (TypeScript helpers for boardgame.io)

Provide ready-to-copy helpers:
- `signHandInit(handInitData)` + collection logic.
- `deriveHandId(handInitData)`.
- `signRoundStateTransition(state)`.
- `signHandOutcome(outcome)`.
- `prepareForceTimeoutPayload(handId, outcome, partialSigs, lastRound)`.

All helpers must use EIP-712 domain separator `"PokerHandSettler","1"`.

### 8. Non-Functional Requirements
- **Tx minimization:** Happy path = 2–9 assertions + 1 settlement. Force path adds 1 extra tx.
- **Gas:** L2-friendly (no loops in hot paths, events for indexing).
- **Security:** All settlement paths require valid signatures. Arithmetic must balance. No re-entrancy. Upgradable via UUPS proxy recommended.
- **Timeouts:** Configurable per-hand (set in HandInit).
- **Rake:** Configurable % sent to immutable operator address on every settlement.
- **Error handling:** Clear custom errors (e.g. `HandAlreadySettled`, `ConflictingOutcome`, `TimeoutNotElapsed`, `InvalidSignatures`, `PendingHandExists`).

### 9. Edge Cases & Guarantees
- Player refuses to sign HandOutcome → force-timeout after timeout → winners paid, remainder + rake to vault.
- Full signatures submitted late → overrides force-timeout.
- Player abandons mid-betting → last signed RoundStateTransition proves actual pot.
- Wallet switch → pending-hand lock still blocks new play/withdrawal until settled.
- Ties/splits → supported natively in payouts[].
- All players honest → zero force-timeout needed.

### 10. Future Extensions (Hooks Provided)
- Chainlink VRF seed in HandInit.
- ZK-SNARK hand-rank proof in HandOutcome.
- ERC-20 batch deposits.
- Reputation / KYC hooks.

### 11. Addendum: Locked Implementation Decisions (v1.1)

These decisions supersede any ambiguous wording above. They were agreed via
clarification round on 2026-05-19.

**11.1 Architecture: Crane Diamond + DFPkg**
- Built on the Crane framework (ERC2535 Diamond pattern) using the Facet-Target-Repo
  layout described in `manamesh/lib/crane/AGENTS.md`.
- Each `PokerHandSettler` is a Diamond proxy deployed via Crane's
  `DiamondPackageCallBackFactory` from a `PokerHandSettlerDFPkg`.
- **Replaces** `manamesh/contracts/src/GameVault.sol` — the legacy `gameId`-centric
  / fold-auth vault is superseded by the PRD's `handId`-centric design.
- Upgrade path: facet swaps via `DiamondCutFacet` (no UUPS proxy). The original
  §8 line "Upgradable via UUPS proxy recommended" is overridden.

**11.2 One settler instance per ERC20 token**
- `HandInit.vault` = the settler instance address (each settler is bound to a
  single ERC20 token, immutable, set at deploy via `PkgArgs.token`).
- `deposit(amount)` and `withdraw(amount)` drop the `token` parameter from the
  original §6 signatures — token is implicit per instance.
- All players in a hand must transact against the same settler instance
  (enforced by signing over the settler/vault address inside `HandInit`).

**11.3 POC v1 scope**
The following are all in v1:
- `deposit` / `withdraw` (per-token, internal balance ledger).
- `assertHandMembership` (unanimous off-chain sig + per-player on-chain assertion).
- `settleHand` (normal, full-signature settlement).
- `forceTimeoutSettlement` (partial-signature settlement after timeout).
- Rake: `bps` configured at deployment, sent to an immutable operator address
  (both set in `PkgArgs`).
- Level-1 on-chain poker hand verifier (stub — see §11.7 for exact scope).

**11.4 Player cap**
- Contract enforces `2 ≤ players.length ≤ 9` per PRD §2 / §3 (overrides the
  current off-chain module's 2–6 limit; off-chain may stay tighter).

**11.5 Timeout clock**
- The per-hand timeout window resets on **any on-chain activity for that handId**
  (assertion, settlement attempt, etc.). `forceTimeoutSettlement` becomes valid
  after `lastActivity + timeoutSeconds`.

**11.6 Off-chain TypeScript signing helpers**
- Live inside `packages/frontend/src/game/modules/poker/` alongside the existing
  poker game module (`betting.ts`, `hands.ts`, `crypto.ts`).
- Add new files (e.g. `signing.ts`, `handId.ts`) — do **not** spin up a separate
  workspace package for v1.

**11.7 Toolchain alignment**
- `manamesh/contracts/foundry.toml`: bump to **solc 0.8.30**, **evm prague**,
  **optimizer runs = 1** to match Crane (the existing `^0.8.24` pragmas across
  manamesh contracts are forward-compatible).
- `manamesh/contracts/remappings.txt`: `@crane/=../lib/crane/` (Crane lives at
  `manamesh/lib/crane/`, not `manamesh/contracts/lib/`).

**11.8 Engineering invariants (carried over from PRD)**
- `handId = keccak256(abi.encode(HandInit fields))`. The contract recomputes
  `handId` from the supplied `HandInit` on every entry point and reverts on
  mismatch — callers cannot desync `handId` from `HandInit`.
- `finalStateHash` is treated as an opaque commitment by the contract: stored,
  emitted in events, but **not** decomposed / verified on-chain in v1.
- Players in `HandInit.players[]` are sorted ascending by address; all parallel
  arrays (`buyIns[]`, `playerHandNonces[]`, `finalStacks[]`) use the same order.

**11.9 Force-timeout signature threshold**
- `lastRoundState` (latest RoundStateTransition) must carry signatures from
  **all** original players. This is the on-chain proof of the pot at the cutoff;
  it was already signed during normal play.
- `HandOutcome` must carry signatures from **all addresses listed in `winners[]`**.
  No player can be paid without their own signature; non-winners do not need
  to sign.
- Any player or third party can submit `forceTimeoutSettlement` once
  `block.timestamp >= lastActivity + timeoutSeconds`.
- Failure modes:
  - If a proposed winner refuses to sign, their share forfeits to the operator
    (per §11.10).
  - If no `lastRoundState` with full sigs ever existed (e.g. abandonment before
    pre-flop), the buy-ins return to depositors' vault balances minus rake.

**11.10 Force-timeout forfeit destination**
- All forfeited amounts go **100% to the operator address** (the same immutable
  operator that receives rake on normal settlements). No on-contract house
  treasury in v1.
- This honors PRD §1's "no player-to-player splitting" rule and keeps state minimal.

**11.11 Level-1 on-chain hand verifier scope**
- Given `holeCards[2]` per player + `communityCards[5]` revealed in `HandOutcome`,
  the contract computes each player's best 5-of-7 hand on-chain, compares ranks
  (and kickers for ties), and reverts if the declared `winners[]` don't match
  the computed winners.
- Implementation: pure Crane `*Service` library invoked by the settlement facet.
  v1 does **not** split the verifier into a separate facet (see §11.9 open
  items below for the v2 upgrade path).
- Does **not** verify the encryption chain (that revealed cards actually
  decrypt from the committed shuffle). That stays off-chain and is captured
  only via `finalStateHash` opacity (§11.8).
- Does **not** apply to `forceTimeoutSettlement` — force path skips card
  evaluation since cards may never have been revealed.

**11.12 Withdraw lock granularity**
- Each player carries a per-settler `lockedAmount` counter — sum of buy-ins
  across their currently-asserted, unsettled hands.
- `withdraw(amount)` succeeds iff `amount <= balance - lockedAmount`.
- The settler ledger only needs `balance` and `lockedAmount` per player;
  the set of pending handIds per player is **not** required on-chain
  (it can be reconstructed from events for indexers).

**11.13 PkgArgs final shape**
- `PokerHandSettlerDFPkg.PkgArgs = { address token }`.
- Operator address and `rakeBps` are **not** baked into the settler. They are
  resolved at settlement time from a separate **Configuration Oracle** (§11.14).
- Each settler holds an immutable reference to the oracle (set in `PkgInit`,
  same for all settlers deployed from a given DFPkg deployment).

**11.14 Configuration Oracle**

*Purpose.* Exposes, per ERC20 token, the rake recipient (`operator`) and rake
rate (`rakeBps`) used by all `PokerHandSettler` instances on that chain.

*Form factor.* Built on Crane as its own Diamond: `BettingConfigOracleRepo`
\+ `BettingConfigOracleTarget` + `BettingConfigOracleFacet`, bundled into a
`BettingConfigOracleDFPkg`. Upgradable via `DiamondCut`. (Working name; final
naming is an implementation detail.)

*Governance.* Single owner via Crane's ERC8023 `MultiStepOwnable` (two-step
ownership transfer). The owner is the only address allowed to:
- Set / update per-token entries (`setTokenConfig(token, operator, rakeBps)`).
- Update the global default (`setDefault(defaultOperator, defaultRakeBps)`).
- Transfer ownership.

*Storage shape (conceptual).*
```
struct Entry { address operator; uint256 rakeBps; }
mapping(address => Entry) tokenConfig;
Entry defaultConfig;                  // { defaultOperator, defaultRakeBps }
```

*Lookup semantics.*
```
(operator, rakeBps) = tokenConfig[token].operator != address(0)
                      ? tokenConfig[token]
                      : defaultConfig;
```

*Lookup timing.* The settler performs a **live read** on every `settleHand`
and `forceTimeoutSettlement`. Config changes apply immediately to all pending
and future hands at that settler. Hands do not snapshot config at activation.

*Settler reference.* Each `PokerHandSettler` diamond holds an **immutable**
reference to the oracle diamond (set in `PokerHandSettlerDFPkg.PkgInit`).
Swapping the oracle implementation is done via `DiamondCut` on the oracle
diamond — settlers do not need to change.

*Default config governance.* The global default is itself owner-mutable
(not a hardcoded baseline). v1 ships with `defaultOperator` and
`defaultRakeBps` set at deployment.

*Events.* Oracle emits typed events on each entry/default change for indexers.
(Specific event signatures to be defined during implementation.)

*Out of scope for v1.* No per-table or per-hand rake overrides; no oracle-level
`maxRakeBps` ceiling (owner is trusted); no batch update entry points (single-
entry mutators only — batching is an off-chain script concern).

**11.15 Off-chain TS data model**
- `PokerHandResult` is refactored to match the on-chain `HandOutcome` exactly
  (parallel arrays sorted by address: `players[]`, `payouts[]`, `finalStacks[]`).
- The `Record<address, number>` form is removed; callers of `buildHandResult`
  update accordingly.

**11.16 Verifier facet decomposition**
- The Level-1 hand verifier ships as a **separate facet** (`IPokerVerifierFacet`)
  from day one, attached to the same settler diamond.
- The settlement facet calls the verifier facet through the diamond's selector
  routing. A v2 ZK verifier can be cut in with a single `DiamondCut`, without
  touching the settlement facet.

**11.17 Repository / toolchain housekeeping** — ✅ RESOLVED
- Poker settlement now lives entirely in the in-tree embedded package
  `manamesh-games/packages/poker/` (`@manamesh/poker`), which owns its own
  Foundry workspace (`packages/poker/foundry.toml`) and `lib/` (forge-installed
  forge-std, openzeppelin-contracts v5, Crane).
- The legacy MM-035 settlement contracts (`GameVault`, `ChipToken`,
  `ChipTokenFactory`, their interfaces, `SignatureVerifier`, and tests) have been
  deleted from `manamesh/contracts/`, along with the orphaned frontend
  `wallet/signing` GameVault helpers (`createGameVaultDomain`,
  `useSignGameVaultAction`). Only the default `Counter.sol` scaffold remains in
  `manamesh/contracts/`; it is no longer relevant to poker settlement.

**11.18 Implementation-detail items deferred to coding phase**

These are not blocking the architecture. Decisions will be made (or surfaced
for confirmation) during implementation:

- Oracle contract / DFPkg final names.
- Full custom-error list across settler + oracle.
- Event signatures for assertion / settlement / oracle config changes.
- `timeoutPlayer` (PRD §6 "optional early warning") — assumed to emit an event
  only, no state change; confirm during coding.
- Test coverage layout (Crane behavior libraries + invariant handlers).
- Deployment script structure (one script per settler instance? one factory
  script that wires oracle + multiple settlers?).
- Whether the vestigial root `manamesh/foundry.toml` + `Counter.sol` should
  be deleted, and whether `contracts/lib/` should be populated via
  `forge install` for OpenZeppelin / forge-std (currently broken).

---

**Acceptance Criteria for Implementation Agent**
- Contracts compile, are fully commented, and pass basic unit tests (Hardhat/Foundry).
- Off-chain TypeScript helpers integrate cleanly into existing ManaMesh poker module.
- Gas usage documented for L2 vs mainnet.
- Security review checklist completed (re-entrancy, signature replay, arithmetic overflow, etc.).

This PRD is complete and self-contained. The implementation agent can now produce:
1. `PokerHandSettler.sol` (and any supporting libraries).
2. Exact EIP-712 TypeScript signing helpers.
3. Sample integration points for boardgame.io.

Please hand this PRD off to the developer. If any clarification is needed before coding begins, let me know. This will be a rock-solid, minimal-tx, production-ready POC for encrypted poker on an untrusted chain.