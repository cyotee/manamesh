# Task MM-049: P2P Crypto & Poker Settlement Security Remediation

**Repo:** ManaMesh
**Status:** In Progress — Phase 1-3 advanced (bindings, combine, UI client, central validation, determinism, full liveness wiring + roundtrip sim test) (2026-06-17)
**Created:** 2026-06-17
**Dependencies:** None (builds on prior crypto extraction and settlement work)
**Worktree:** `feat/security-remediation-p2p-crypto`
**Related:** SECURITY_REPORT.md (May 2026), the 2026-06-17 security review report at /tmp/manamesh-security-review-2026-06-17.md

---

## Description

Address the security and correctness issues identified in the June 2026 review of the secure P2P card game modules (boardgameio-crypto primitives + usage in poker/war/gofish/onepiece, P2P auth layer, and poker on-chain settler).

The review found 15 issues (many critical/high). Core problems include:
- Incomplete player identity binding to `ctx.playerID`.
- Broken decryption share combining logic in Poker.
- Missing or incomplete curve point validation.
- No integrity check on the shared `cardPointLookup`.
- Non-deterministic values inside boardgame.io moves.
- `authenticateCredentials` stub + insufficient P2P binding.
- Lack of stall/abandonment protection in Poker.
- Settlement that trusts off-chain reveals with no transcript binding.

Goal: Make the mental poker protocol and settlement path safe for adversarial P2P play (at minimum for honest-but-curious + moderate malice) and reliable for on-chain chip settlement.

## Dependencies
- Crypto primitives live in `packages/boardgameio-crypto/`
- Game logic: `packages/poker/`, `packages/manamesh/packages/frontend/src/game/modules/{war,gofish,...}`
- P2P: `packages/boardgameIO-p2p/`
- Contracts + settlement bridge: `packages/poker/contracts/settler`, `packages/poker/src/handOutcome.ts`, `signing.ts`
- Existing tests: vitest suites + foundry tests under `packages/poker/tests/foundry/`

## User Stories
### US-MM-049.1: Prevent player impersonation of decryption contributions
As a player in a crypto game, I want decryption shares and setup moves to be bound to the actual sender so that a malicious peer cannot submit shares on my behalf.

### US-MM-049.2: Make cooperative reveals actually work and safe
As a player, when all participants submit valid decryption results, the card must correctly reduce to layers===0 and resolve to the right card ID (no garbage from wrong combine logic). Invalid points must be rejected early.

### US-MM-049.3: Eliminate non-determinism that causes desync
As any peer (host or guest), game state and replays must be identical regardless of wall clock or local randomness, so that reveals, betting, and settlement hand results match across all participants.

### US-MM-049.4: Defend against reveal-phase griefing
As an honest player, I want stalled decrypt requests (especially in Poker) to eventually allow abort/void instead of permanent deadlock.

### US-MM-049.5: Make on-chain settlement reflect actual off-chain play
As a participant with on-chain chips, I want settlement to be backed by (or at least bound to) the mental-poker transcript so that fabricated hole cards cannot be successfully settled.

## Technical Details & Approach

### Core Principles
- Defense in depth: bind identity at game move level + P2P transport.
- Centralize validation in `boardgameio-crypto` so war/poker/gofish/onepiece stay consistent.
- All move handlers that touch player-controlled values must be synchronous and deterministic.
- Changes must not break honest 2-6 player flows (existing happy-path tests must continue to pass).
- For settlement, Phase 5 is the long-term fix; earlier phases improve safety of the data that reaches settlement.

### Key Shared Helpers (add to boardgameio-crypto)
- `validatePlayerIdentity(ctx, claimedPlayerId): boolean`
- `validateEncryptedCard(card: EncryptedCard): boolean` (calls secpIsValidPointHex + other invariants)
- `verifyCardPointLookup(cardIds, lookup): boolean` (recompute via hashToPoint and compare)
- `makeRequestId(ctx, purpose, ...)` using turn/numMoves only
- `getLogicalTimestamp(ctx)` or use `ctx.numMoves` for stall windows

### Poker Combine Logic Fix
Current code restarts from original zone and does `decrypt(decrypted, share.ciphertext)`. This is incorrect. Align with War's progressive update pattern (players send the further-peeled result; collector overwrites the current ciphertext in the request/zone). Validate each incoming share.

## Files to Create/Modify

**New Files:**
- `packages/manamesh/tasks/MM-049-p2p-crypto-security-remediation.md` (this file)
- `packages/boardgameio-crypto/src/security.ts` (or extend plugin/validation utils) — shared validators
- New test files or extensions:
  - `packages/poker/src/crypto.adversarial.test.ts`
  - `packages/boardgameio-crypto/src/mental-poker/sra.security.test.ts`
  - Foundry test updates for transcript ideas (Phase 5)

**Core Modified Files (Phase 1 priority):**
- `packages/poker/src/crypto.ts` (all playerId checks, approveDecrypt, submitDecryptedShare, process*Decrypt, requestDecrypt, peek, setup moves, Date/UUID sites, combine logic)
- `packages/manamesh/packages/frontend/src/game/modules/war/crypto.ts` (binding + validation unification)
- `packages/manamesh/packages/frontend/src/game/modules/gofish/crypto.ts` (same)
- `packages/manamesh/packages/frontend/src/game/modules/onepiece/...` (audit for similar patterns)
- `packages/boardgameio-crypto/src/mental-poker/sra.ts` (add guards in encrypt/decrypt, export validators)
- `packages/boardgameio-crypto/src/plugin/crypto-plugin.ts` (submitDecryptedShare path)
- `packages/boardgameio-crypto/src/integration/setup-utils.ts` (lookup verification helper)
- Game definitions: `CryptoPokerGame`, war/gofish equivalents (authenticateCredentials + move wrappers)
- `packages/boardgameIO-p2p/src/authentication.ts` + `host.ts` (per-action binding where feasible)

**Contract / Settlement (Phases 4-5):**
- `packages/poker/contracts/settler/PokerHandSettlerTarget.sol` (activity bumps, low-s, lastRoundState sigs)
- `packages/poker/contracts/lib/SignatureLib.sol` (add low-s check)
- `packages/poker/src/handOutcome.ts` + `signing.ts` (include transcript commitment hash)
- `packages/poker/src/crypto.ts` (buildHandResult / settlement data)

**Tests & Verification:**
- Update existing `*.test.ts` and foundry tests
- Add adversarial cases for the 8-10 scenarios listed in prior SECURITY_REPORT.md + new ones

## Phased Implementation Plan

### Phase 1 — Critical Correctness & Identity (Highest priority, land first)
1. Unconditionally bind `playerId !== ctx.playerID` (or derive from ctx) at the **very top** of every move that accepts a playerId arg. Remove the `!== undefined &&` guard. Apply to setup moves too.
2. Introduce and use `validateEncryptedCard` / `secpIsValidPointHex` (or stronger) on every incoming decryptedCard + before any internal decode in SRA core.
3. **Fix the Poker combine bug**: Rewrite the loops in `processCommunityCardDecrypt` and peek completion to correctly use the peeled `decryptedCard` values sent by players (progressive or final-share selection). Ensure layers===0 + correct lookup. Mirror war's zone update pattern where possible.
4. Add early return of `INVALID_MOVE` instead of throwing or producing "unknown" cards.
5. Add a `verifyAndRebuildCardPointLookup` (or assert) at end of setup and before any reveal resolution.
6. Add unit tests that exercise full multi-player reveal round-trips and impersonation attempts (must return INVALID_MOVE).

**Verification:** All existing happy-path tests + new adversarial tests pass. Manual 2-player poker/war reveal flow works end-to-end.

### Phase 2 — Determinism
1. Replace all `crypto.randomUUID()` used for requestId/handId (when they affect state) with deterministic construction: `decrypt-${ctx.turn}-${ctx.numMoves}-${playerId}-${zone}-${index}`.
2. Replace `Date.now()` used for logic/stalls/recentFolds with logical values (`ctx.numMoves`, a phase-entered move counter already present in War, etc.). Keep wall time only for pure UI notifications.
3. Update `buildHandResult` and any settlement data to avoid non-deterministic fields or derive them logically.
4. Audit and fix similar patterns in war/gofish/onepiece.

**Verification:** State after identical move sequences is bit-identical across simulated peers. Replays succeed.

### Phase 3 — Liveness / Abandonment (Poker + unification)
1. Port or implement `*_REVEAL_STALL_WINDOW_MOVES` + `voteAbortReveal` (or equivalent) for Poker decryptRequests (both hole and community).
2. On abort, mark the refusing player and allow game to void or proceed to forced reveal where safe.
3. Unify the stall window constant and logic via shared helpers.
4. Consider minimal on-chain implication (last activity or signed round state).

### Phase 4 — Auth & Transport Hardening
1. Replace or augment `authenticateCredentials: () => true` with a real check that can be wired to P2P credentials (or a no-op stub that at least documents the reliance on transport).
2. In `boardgameIO-p2p` Host, enforce action-level playerID binding (sign action hash including turn/numMoves/matchID) before passing to Master.
3. Document the trust model (one player acts as host; all players must still verify locally).

### Phase 5 — Settlement Transcript Binding (larger change)
1. Extend `HandInit` / `HandOutcome` (and corresponding TS types) to carry a `transcriptCommitment` (hash of encrypted deck root + per-player shuffle commitments + final reveal layer points or a compact representation).
2. Wire the commitment from the completed crypto game state into `buildSettlement` / `buildHandResult`.
3. On-chain: store the commitment at assert time; require it (or a proof) on settle when verifier is enabled. For v1, at least include it so disputes can reference it off-chain.
4. Add low-s validation in SignatureLib.
5. Bump `lastActivity` on relevant actions; fully bind/verify `lastRoundState` signatures in forceTimeout.
6. Update foundry tests and parity vectors.

### Phase 6 — Polish, Tests, Documentation
- Centralized validation module + use it everywhere.
- Property-based / round-trip tests for SRA multi-party (in boardgameio-crypto).
- Adversarial matrix tests (impersonate, bad points, stall N moves, tampered lookup, wrong settlement cards).
- Update AGENTS.md / SECURITY_REPORT.md with "as of MM-049" status.
- Run full test suite + foundry + typecheck + build.

## Progress (as of implementation start)

- ✅ Phase 1: Unconditional player identity binding across all major crypto modules (poker, war, gofish, onepiece).
- ✅ Phase 1: Fixed broken Poker share combine logic (most-reduced share selection instead of invalid `decrypt(share.ciphertext)`).
- ✅ Phase 1: PokerBoard now computes local peeled `EncryptedCard` before sending shares.
- ✅ Centralized `validateEncryptedCard` + `validatePlayerIdentity` in boardgameio-crypto (used in game modules).
- ✅ Added defensive point-known checks and lookup integrity comments.
- ✅ Added security test describes + full round-trip sim (approve → stall → abort → void + buildHandResult with aborted flag/refunds).
- ✅ Wired abort deeper: UI stall banner + refusers display + auto-indicator, abortedDecrypt fed to buildHandResult, phase void on abort.
- ✅ Light Phase 4: improved authenticateCredentials stub + comment.
- ✅ Additional determinism: request timestamps use logical numMoves for stall logic.
- Tests: boardgameio-crypto (126/126 passed), poker runnable suites (80/80 in non-crypto.test files).

## Completion Criteria
- [ ] All critical and high issues from the 2026-06-17 review have clear fixes or documented accepted limitations.
- [ ] No `playerId` move accepts an unauthenticated identity.
- [ ] Full poker reveal (hole + community + showdown) works correctly for 2-6 players and rejects bad input.
- [ ] Game states are deterministic across replays.
- [ ] Poker has stall abort for decrypt phases.
- [ ] All new + existing tests pass (`yarn test`, `forge test` in poker package).
- [ ] Build + typecheck clean.
- [ ] Settlement data produced by a completed honest game can be submitted on-chain without conservation or verifier revert (for verifier-enabled path).
- [ ] Updated security documentation.

## Risks & Out of Scope (for this task)
- Full zero-knowledge shuffle proofs (still commit-reveal; noted in code).
- Economic slashing / on-chain enforcement of mid-game behavior (settlement is post-game).
- Complete removal of host trust (pure P2P still has a semi-trusted host for ordering).
- Re-implementing Shamir key escrow for all games (currently intentionally de-emphasized in favor of stake; can be a follow-up).
- Changes to non-crypto game modes.

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
