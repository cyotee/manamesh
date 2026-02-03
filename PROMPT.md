# Agent Task Assignment

**Task:** MM-035 - Bet Settlement & Escrow Vault
**Repo:** ManaMesh
**Mode:** Code Review
**Task Directory:** tasks/MM-035-bet-settlement-escrow/

## Required Reading

1. `tasks/MM-035-bet-settlement-escrow/TASK.md` - Requirements to verify
2. `PRD.md` - Project context and standards (if exists)
3. `tasks/MM-035-bet-settlement-escrow/PROGRESS.md` - Implementation notes
4. `tasks/MM-035-bet-settlement-escrow/REVIEW.md` - Your review document

## Review Instructions

1. Read TASK.md to understand what was required
2. Read PROGRESS.md to understand what was implemented

3. **If unclear on review criteria:**
   - Use AskUserQuestion to clarify expectations
   - Write questions and answers to REVIEW.md "Clarifying Questions" section

4. **Review the code:**
   - Check all acceptance criteria in TASK.md are met
   - Verify test coverage
   - Look for bugs, edge cases, security issues
   - Update REVIEW.md with findings as you go
   - Mark findings as Resolved if you answer your own questions

5. **Write suggestions:**
   - Document actionable improvements in REVIEW.md
   - Prioritize by severity
   - These will be used to create follow-up tasks

6. When review is complete: `<promise>PHASE_DONE</promise>`
7. If blocked: `<promise>BLOCKED: [reason]</promise>`

## Files to Review

**Smart Contracts:**
- `contracts/src/ChipToken.sol` - ERC-20 chip token with permit
- `contracts/src/GameVault.sol` - Escrow and settlement logic
- `contracts/src/libraries/SignatureVerifier.sol` - EIP-712 verification
- `contracts/src/interfaces/IChipToken.sol` - Token interface
- `contracts/src/interfaces/IGameVault.sol` - Vault interface

**Tests:**
- `contracts/test/ChipToken.t.sol` - Token tests (20 tests)
- `contracts/test/GameVault.t.sol` - Vault tests (20 tests)

**Frontend Types:**
- `packages/frontend/src/wallet/signing/types.ts` - EIP-712 types
- `packages/frontend/src/wallet/signing/sign.ts` - Signing hooks
- `packages/frontend/src/wallet/signing/index.ts` - Exports

## On Context Compaction

If context is compacted or you're resuming:
1. Re-read this PROMPT.md
2. Re-read REVIEW.md for your prior findings
3. Continue review from where you left off

## CRITICAL: Forbidden Commands

**You must NEVER invoke these commands yourself:**

- `/backlog:complete` - USER-ONLY: marks task complete
- `/backlog:review` - USER-ONLY: transitions to review mode

These commands control workflow state transitions. Only the user decides when
to transition. Your job is to review, signal PHASE_DONE, and wait.
