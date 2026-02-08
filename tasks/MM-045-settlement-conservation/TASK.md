# Task MM-045: Conservation-Safe Settlement Redesign

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-08
**Dependencies:** MM-035, MM-044
**Worktree:** `feature/MM-045-settlement-conservation`
**Origin:** Code review suggestion 3 from MM-035

---

## Description

The current `_settleHand()` implementation credits the full `potAmount` to the winner and deducts `potAmount/(players.length-1)` from each loser, clamping to their escrow balance. This creates value when losers have insufficient escrow (total credits exceed total debits), inflating total escrow. It also divides by zero with a single player.

Redesign settlement to use explicit per-player deltas that are validated to sum to zero before applying to escrow. This ensures conservation (no funds created or destroyed) and supports arbitrary game logic beyond equal-split.

(Created from code review of MM-035 — Finding 4, Suggestion 3)

## Dependencies

- MM-035: Bet Settlement & Escrow Vault (complete, archived)
- MM-044: EIP-712 Alignment (settlement signatures must work first)

## User Stories

### US-MM-045.1: Conservation-Safe Settlement

As a player, I want settlement to never create or destroy funds so that the vault remains solvent.

**Acceptance Criteria:**
- [ ] Settlement accepts explicit per-player deltas (positive = credit, negative = debit)
- [ ] `sum(deltas) == 0` enforced on-chain (revert if violated)
- [ ] No player's escrow goes below zero (revert if insufficient)
- [ ] Minimum 2 players required for settlement (revert on single player)
- [ ] Settlement struct updated in `IGameVault.sol` to use deltas model
- [ ] `HandResult` EIP-712 type updated to include per-player deltas
- [ ] Frontend signing updated to produce delta-based settlements
- [ ] Fuzz test: random delta arrays always maintain conservation invariant
- [ ] Test: attempt settlement that would inflate escrow (must revert)
- [ ] All existing tests updated for new settlement model
- [ ] Build succeeds

## Files to Create/Modify

**Modified Files:**
- `contracts/src/GameVault.sol` — Redesign `_settleHand()` with delta model
- `contracts/src/interfaces/IGameVault.sol` — Update settlement struct
- `contracts/src/libraries/SignatureVerifier.sol` — Update `HandResult` hash
- `contracts/test/GameVault.t.sol` — Update settlement tests, add fuzz tests
- `packages/frontend/src/wallet/signing/types.ts` — Update `HandResult` type
- `packages/frontend/src/wallet/signing/sign.ts` — Update settlement signing

## Inventory Check

Before starting, verify:
- [ ] MM-035 is complete
- [ ] MM-044 is complete (EIP-712 must be aligned first)
- [ ] `contracts/src/GameVault.sol` exists
- [ ] `forge build` succeeds from `contracts/`

## Completion Criteria

- [ ] Conservation invariant holds under all test scenarios
- [ ] Fuzz tests pass
- [ ] All acceptance criteria met
- [ ] Tests pass (`forge test` from `contracts/`)
- [ ] Build succeeds (both `forge build` and `yarn build`)

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
