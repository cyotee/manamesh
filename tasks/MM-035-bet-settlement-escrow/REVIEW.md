# Code Review: MM-035

**Reviewer:** OpenCode
**Review Started:** 2026-02-01
**Status:** Complete

---

## Clarifying Questions

Questions asked to understand review criteria:

- None.

---

## Review Findings

### Finding 1: ChipToken is insolvent when minting from ERC-20 deposits

**File:** `contracts/src/ChipToken.sol`
**Severity:** Critical
**Description:** `depositToken()` mints CHIP without increasing the ETH reserve, but `withdraw()` always returns ETH 1:1 for burned chips. This allows a user to deposit an ERC-20, mint chips, then withdraw ETH that was deposited by other users (or any ETH sent to the contract), breaking “chips are backed by deposited assets” and enabling theft.
**Status:** Open
**Resolution:** Track backing per-asset (separate reserves) and implement `withdrawToken()`, or restrict CHIP to be ETH-backed only (disable `depositToken()` / or prevent ETH-withdraw of chips minted from token deposits).

### Finding 2: Frontend EIP-712 domain does not match on-chain verification domain

**File:** `contracts/src/GameVault.sol`
**Severity:** Critical
**Description:** `GameVault` inherits OZ `EIP712("ManaMesh","1")`, so the domain separator includes at least `chainId` and `verifyingContract` (and therefore is chain-specific and contract-specific). Frontend signing uses `MANAMESH_DOMAIN` without `chainId` and without `verifyingContract` (`packages/frontend/src/wallet/signing/domain.ts`). Wallet-produced signatures using this domain will not verify in `GameVault`.
**Status:** Open
**Resolution:** For actions intended for on-chain submission (HandResult/FoldAuth/Abandonment/Bet-for-dispute), sign with a domain that includes the correct `chainId` and `verifyingContract` (the deployed `GameVault` address). Use `createChainSpecificDomain()` and add verifyingContract support.

### Finding 3: EIP-712 hashing for arrays likely mismatches wallet-produced signatures

**File:** `contracts/src/libraries/SignatureVerifier.sol`
**Severity:** Critical
**Description:** `hashFoldAuth()` and `hashAbandonment()` hash `address[]` and `uint256[]` with `keccak256(abi.encodePacked(...))`. EIP-712 array encoding expects each element to be encoded as a 32-byte word (per ABI rules for typed data), whereas `abi.encodePacked(address)` uses 20-byte values. This risks on-chain verification failing for signatures produced by standard EIP-712 tooling.
**Status:** Open
**Resolution:** Implement EIP-712 array hashing using 32-byte element encoding (e.g., build a `bytes` buffer via `abi.encode` per element, or use `abi.encodePacked(bytes32(uint256(uint160(addr))))` for `address[]`, and `abi.encodePacked(bytes32(value))` for `uint256[]`). Add cross-check tests that compare the contract struct hash to a known-good off-chain EIP-712 hash.

### Finding 4: Settlement accounting can inflate total escrow and can revert on 1-player games

**File:** `contracts/src/GameVault.sol`
**Severity:** Critical
**Description:** `_settleHand()` credits `hand.potAmount` to the winner, then deducts `potAmount/(players.length-1)` from each loser but clamps deductions to each loser’s current escrow. If a loser has insufficient escrow, the contract still credits the full pot to the winner, increasing total escrow (value creation). Also, `players.length - 1` divides by zero if a game has a single recorded player.
**Status:** Open
**Resolution:** Enforce conservation: require sufficient escrow for required losses, or compute explicit per-player deltas that sum to zero, and apply them atomically. Add input validation that games must have at least 2 players.

### Finding 5: Abandonment claim lacks key validation and can arbitrarily mint/redirect funds

**File:** `contracts/src/GameVault.sol`
**Severity:** Critical
**Description:** `claimAbandonment()` does not validate `claim.gameId == gameId`, does not validate `splitRecipients.length == splitAmounts.length`, does not validate that `sum(splitAmounts)` equals the abandoned player’s forfeited amount, and does not restrict recipients to the remaining players. The claim can therefore inflate escrow or send escrow to arbitrary addresses.
**Status:** Open
**Resolution:** Validate all claim invariants (gameId match, length match, sum equals forfeited, recipients subset of remaining players, and optional: no duplicates). Revert on invalid claims.

### Finding 6: Fold authorization is not enforced and input lengths can cause out-of-bounds

**File:** `contracts/src/GameVault.sol`
**Severity:** High
**Description:** `_processFolds()` iterates `folds` and indexes `foldSigs[i]` without checking `foldSigs.length == folds.length` (out-of-bounds revert). Also, `FoldAuth.authorizedSettlers` is never checked during settlement, so anyone can submit settlement “without folded player's signature” as long as they possess the fold signature.
**Status:** Open
**Resolution:** Add length checks and enforce that `msg.sender` is included in `authorizedSettlers` for that fold (and ideally that the fold is for the same `gameId` / current hand context).

### Finding 7: Dispute flow is a stub and does not meet acceptance criteria

**File:** `contracts/src/GameVault.sol`
**Severity:** High
**Description:** `disputeHand()` verifies a bet chain using a round-robin signer model (not the actual bettor), uses placeholder winner logic, does not override any stored settlement outcome, and refunds the stake unconditionally. The task requirements call for replaying bet chain to determine winner, stake-based anti-griefing, and penalizing the loser.
**Status:** Open
**Resolution:** Include bettor identity in `Bet` (or otherwise bind bets to signers), enforce betChain belongs to `handId`, implement actual dispute resolution that affects escrow/settlement state, and implement stake slashing rules.

### Finding 8: Frontend bet hashing is not compatible with Solidity `hashBet()`

**File:** `packages/frontend/src/wallet/signing/sign.ts`
**Severity:** High
**Description:** `hashBet()` uses `keccak256(JSON.stringify(...))` as a placeholder. This will not match `SignatureVerifier.hashBet()` (ABI-encoded struct hashing), so `previousBetHash` linking and “finalBetHash” integrity cannot be computed correctly off-chain.
**Status:** Open
**Resolution:** Implement Solidity-equivalent hashing with `viem` ABI encoding (typed data struct hash or ABI encode of the struct fields exactly as Solidity does).

### Finding 9: Coverage gaps vs TASK.md acceptance criteria

**File:** `contracts/test/GameVault.t.sol`
**Severity:** Medium
**Description:** Tests cover join/leave, basic settlement, fold, and withdraw, but do not cover `joinGameWithPermit`, `claimAbandonment`, or `disputeHand`. Task acceptance criteria also mention frontend signing/verification tests which are not present in the files reviewed.
**Status:** Open
**Resolution:** Add targeted tests for permit join, abandonment timeouts + distribution invariants, and dispute stake + resolution effects. Add frontend unit tests for settlement signing and bet chain hashing/verification.

### Finding 10: Repro steps inconsistency for repo-level test/build

**File:** `packages/frontend/vite.config.ts`
**Severity:** Low
**Description:** Running `forge test` from repo root fails due to vendored OpenZeppelin tests/harnesses being compiled; running from `contracts/` succeeds. `yarn test` / `yarn build` currently fail in this workspace with a Yarn PnP resolution error around `@tanstack/query-core` (likely requires a fresh `yarn install` to update `.pnp.cjs`).
**Status:** Open
**Resolution:** Document the correct invocation (`forge test` in `contracts/`), and ensure dependencies are installed/consistent for frontend build/test.

---

## Suggestions

Actionable items for follow-up tasks:

### Suggestion 1: Decide and enforce a single backing model for CHIP

**Priority:** P0
**Description:** Either (1) make CHIP strictly ETH-backed (remove token deposits / or track “ETH-minted chips” separately), or (2) implement multi-asset backing with asset-specific withdrawal and solvency accounting.
**Affected Files:**

- `contracts/src/ChipToken.sol`
- `contracts/test/ChipToken.t.sol`
  **User Response:** (pending)
  **Notes:** This is the largest security/safety issue.

### Suggestion 2: Align on-chain and off-chain EIP-712 (domain + hashing)

**Priority:** P0
**Description:** For on-chain-submitted actions, sign using `chainId` + `verifyingContract` and implement spec-correct struct hashing (including arrays). Add tests that validate wallet-produced signatures can be verified on-chain (or at least a known-good off-chain hash matches).
**Affected Files:**

- `contracts/src/GameVault.sol`
- `contracts/src/libraries/SignatureVerifier.sol`
- `packages/frontend/src/wallet/signing/domain.ts`
- `packages/frontend/src/wallet/signing/sign.ts`
- `packages/frontend/src/wallet/signing/verify.ts`
  **User Response:** (pending)
  **Notes:** Without this, settlement signatures won’t verify.

### Suggestion 3: Redesign settlement to be conservation-safe and game-agnostic

**Priority:** P0
**Description:** Replace “equal loser split” with explicit per-player deltas (or per-player contributions) validated to sum to zero, then apply to escrow. This prevents inflation and supports arbitrary game logic.
**Affected Files:**

- `contracts/src/GameVault.sol`
- `contracts/src/interfaces/IGameVault.sol`
- `contracts/test/GameVault.t.sol`
  **User Response:** (pending)
  **Notes:** This also improves gas predictability.

### Suggestion 4: Harden abandonment and fold flows (authorization + invariants)

**Priority:** P1
**Description:** Validate all lengths and sums, bind claims to the correct game/hand, enforce authorized settlers in fold flow, and ensure recipients are valid remaining players.
**Affected Files:**

- `contracts/src/GameVault.sol`
- `contracts/test/GameVault.t.sol`
  **User Response:** (pending)
  **Notes:** Prevents escrow minting and unauthorized settlement.

### Suggestion 5: Make dispute mechanism real or explicitly mark it out-of-scope

**Priority:** P1
**Description:** Either implement full dispute logic (including bet signer identity, chain replay rules, and stake slashing) or remove the function from the interface and task scope until the game-specific logic is ready.
**Affected Files:**

- `contracts/src/GameVault.sol`
- `contracts/src/interfaces/IGameVault.sol`
- `contracts/test/GameVault.t.sol`
  **User Response:** (pending)
  **Notes:** Current implementation is mostly signaling/events.

---

## Review Summary

**Findings:** 10 (5 critical)
**Suggestions:** 5
**Recommendation:** Do not ship as-is; fix CHIP solvency + EIP-712 domain/hashing + settlement conservation first.

---

**When review complete, output:** `<promise>PHASE_DONE</promise>`
