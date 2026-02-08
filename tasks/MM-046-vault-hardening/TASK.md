# Task MM-046: Vault Authorization Hardening & Dispute Resolution

**Repo:** ManaMesh
**Status:** Blocked
**Created:** 2026-02-08
**Dependencies:** MM-035, MM-044, MM-045
**Worktree:** `feature/MM-046-vault-hardening`
**Origin:** Code review suggestions 4-5 from MM-035

---

## Description

Harden the GameVault's abandonment and fold authorization flows to prevent escrow inflation and unauthorized settlement. Also decide whether to implement the dispute mechanism fully or mark it out-of-scope until game-specific logic is ready.

Abandonment: `claimAbandonment()` lacks validation of gameId match, array length parity, sum conservation, and recipient restriction. Fold: `_processFolds()` doesn't check array lengths and doesn't enforce `authorizedSettlers`. Dispute: current implementation is a stub with placeholder winner logic.

(Created from code review of MM-035 — Findings 5-7, Suggestions 4-5)

## Dependencies

- MM-035: Bet Settlement & Escrow Vault (complete, archived)
- MM-044: EIP-712 Alignment (signatures must work before authorization can be verified)
- MM-045: Conservation-Safe Settlement (settlement model must be finalized first)

## User Stories

### US-MM-046.1: Harden Abandonment Claims

As a player, I want abandonment claims to be validated so that funds cannot be redirected to arbitrary addresses.

**Acceptance Criteria:**
- [ ] `claim.gameId == gameId` validated (revert on mismatch)
- [ ] `splitRecipients.length == splitAmounts.length` validated
- [ ] `sum(splitAmounts) == forfeited amount` validated (conservation)
- [ ] Recipients restricted to remaining players in the game
- [ ] No duplicate recipients allowed
- [ ] Test: abandonment claim with wrong gameId (must revert)
- [ ] Test: abandonment claim with mismatched arrays (must revert)
- [ ] Test: abandonment claim with inflated amounts (must revert)
- [ ] Test: abandonment claim with unauthorized recipient (must revert)

### US-MM-046.2: Harden Fold Authorization

As a player, I want fold authorizations to be properly checked so that only authorized settlers can submit settlements with my folds.

**Acceptance Criteria:**
- [ ] `foldSigs.length == folds.length` validated (revert on mismatch)
- [ ] `msg.sender` must be in `FoldAuth.authorizedSettlers` for each fold
- [ ] Fold's `gameId` must match the current settlement's game context
- [ ] Test: fold with wrong-length signatures array (must revert)
- [ ] Test: settlement by unauthorized settler (must revert)
- [ ] Test: fold for wrong game (must revert)

### US-MM-046.3: Dispute Resolution Decision

As a developer, I want the dispute mechanism to either work correctly or be explicitly removed so that the codebase doesn't contain misleading stubs.

**Acceptance Criteria:**
- [ ] Decision documented: implement full disputes OR remove stub
- [ ] If implementing: bind bets to signers, enforce bet chain belongs to handId, implement actual winner determination, implement stake slashing
- [ ] If removing: remove `disputeHand()` from contract and interface, document as future work
- [ ] Tests cover whichever path is chosen

## Files to Create/Modify

**Modified Files:**
- `contracts/src/GameVault.sol` — Harden abandonment, fold, and dispute flows
- `contracts/src/interfaces/IGameVault.sol` — Update interface if dispute removed
- `contracts/test/GameVault.t.sol` — Add validation tests for all hardened flows

## Inventory Check

Before starting, verify:
- [ ] MM-035 is complete
- [ ] MM-044 is complete (EIP-712 aligned)
- [ ] MM-045 is complete (settlement redesigned)
- [ ] `contracts/src/GameVault.sol` exists
- [ ] `forge build` succeeds from `contracts/`

## Completion Criteria

- [ ] All acceptance criteria met for chosen approach
- [ ] No authorization bypass paths remain
- [ ] All validation tests pass
- [ ] Existing tests updated and passing
- [ ] Build succeeds (`forge build` from `contracts/`)

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
