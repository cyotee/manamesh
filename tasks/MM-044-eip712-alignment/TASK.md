# Task MM-044: EIP-712 On-Chain/Off-Chain Alignment

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-08
**Dependencies:** MM-035
**Worktree:** `feature/MM-044-eip712-alignment`
**Origin:** Code review suggestions 2 from MM-035

---

## Description

The frontend EIP-712 domain does not match on-chain verification: `GameVault` inherits OZ `EIP712("ManaMesh","1")` which includes `chainId` and `verifyingContract`, but the frontend `MANAMESH_DOMAIN` omits both. Additionally, `SignatureVerifier.sol` hashes `address[]` and `uint256[]` using `abi.encodePacked` (20-byte addresses) instead of EIP-712 spec-correct 32-byte element encoding. Wallet-produced signatures will not verify on-chain.

Fix both the domain configuration and array hashing to make frontend signatures verifiable by the contract. Add cross-check tests.

(Created from code review of MM-035 — Findings 2-3, Suggestion 2)

## Dependencies

- MM-035: Bet Settlement & Escrow Vault (complete, archived)

## User Stories

### US-MM-044.1: Fix EIP-712 Domain Alignment

As a player, I want my wallet-signed messages to verify correctly on-chain so that settlement, fold, and abandonment flows actually work.

**Acceptance Criteria:**
- [ ] Frontend domain includes `chainId` and `verifyingContract` for on-chain-submitted actions
- [ ] `createChainSpecificDomain(chainId, contractAddress)` function exists in frontend
- [ ] Frontend and Solidity domains produce identical domain separators
- [ ] Cross-check test: compute domain separator in both Solidity and TypeScript, assert equal

### US-MM-044.2: Fix EIP-712 Array Hashing

As a developer, I want EIP-712 array encoding to follow the spec so that standard wallet tooling produces verifiable signatures.

**Acceptance Criteria:**
- [ ] `hashFoldAuth()` and `hashAbandonment()` use 32-byte element encoding for arrays
- [ ] `address[]` encoded as `keccak256(abi.encode(addr1, addr2, ...))` or equivalent spec-correct encoding
- [ ] `uint256[]` encoded as `keccak256(abi.encode(val1, val2, ...))` per EIP-712 spec
- [ ] Frontend `hashBet()` reimplemented using viem ABI encoding (not `JSON.stringify`)
- [ ] Cross-check test: known-good off-chain struct hash matches on-chain struct hash
- [ ] All existing tests still pass

## Files to Create/Modify

**Modified Files:**
- `contracts/src/GameVault.sol` — Domain configuration (if needed)
- `contracts/src/libraries/SignatureVerifier.sol` — Fix array hashing
- `packages/frontend/src/wallet/signing/domain.ts` — Add chain-specific domain
- `packages/frontend/src/wallet/signing/sign.ts` — Fix `hashBet()` to use ABI encoding
- `packages/frontend/src/wallet/signing/verify.ts` — Update verification
- `contracts/test/GameVault.t.sol` — Add cross-check tests

## Inventory Check

Before starting, verify:
- [ ] MM-035 is complete
- [ ] `contracts/src/libraries/SignatureVerifier.sol` exists
- [ ] `packages/frontend/src/wallet/signing/` directory exists
- [ ] `forge build` succeeds from `contracts/`

## Completion Criteria

- [ ] Domain separators match between frontend and contract
- [ ] Array hashing matches between frontend and contract
- [ ] Cross-check tests pass
- [ ] All existing tests still pass
- [ ] Build succeeds (both `forge build` and `yarn build`)

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
