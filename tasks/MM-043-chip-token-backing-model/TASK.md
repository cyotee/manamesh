# Task MM-043: CHIP Token Backing Model Fix

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-08
**Dependencies:** MM-035
**Worktree:** `feature/MM-043-chip-token-backing`
**Origin:** Code review suggestion 1 from MM-035

---

## Description

The ChipToken contract has a critical insolvency bug: `depositToken()` mints CHIP without increasing the ETH reserve, but `withdraw()` always returns ETH 1:1 for burned chips. This allows a user to deposit an ERC-20, mint chips, then withdraw ETH deposited by other users — effectively stealing funds.

Decide and enforce a single backing model for CHIP: either (1) make CHIP strictly ETH-backed (remove or disable token deposits), or (2) implement multi-asset backing with per-asset solvency accounting and asset-specific withdrawal.

(Created from code review of MM-035 — Finding 1, Suggestion 1)

## Dependencies

- MM-035: Bet Settlement & Escrow Vault (complete, archived)

## User Stories

### US-MM-043.1: Enforce CHIP Solvency Invariant

As a player, I want the CHIP token to be fully backed by deposited assets so that I can always withdraw what I deposited.

**Acceptance Criteria:**
- [ ] Decide backing model: ETH-only OR multi-asset (document decision in this file)
- [ ] If ETH-only: remove or disable `depositToken()`, ensure all CHIP minted via `deposit()` (ETH)
- [ ] If multi-asset: track per-asset reserves, implement `withdrawToken()`, prevent cross-asset withdrawal
- [ ] Solvency invariant: `totalSupply() <= sum(all reserves)` always holds
- [ ] Add invariant test that checks solvency after every operation sequence
- [ ] Add test: deposit ERC-20 then attempt ETH withdraw (must fail or return correct asset)
- [ ] All existing tests still pass
- [ ] Build succeeds (`forge build`)

## Files to Create/Modify

**Modified Files:**
- `contracts/src/ChipToken.sol` — Fix backing model
- `contracts/test/ChipToken.t.sol` — Add solvency tests (create if not exists)

## Inventory Check

Before starting, verify:
- [ ] MM-035 is complete
- [ ] `contracts/src/ChipToken.sol` exists
- [ ] `forge build` succeeds from `contracts/`

## Completion Criteria

- [ ] All acceptance criteria met
- [ ] Solvency invariant holds under fuzz testing
- [ ] Tests pass (`forge test` from `contracts/`)
- [ ] Build succeeds

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
