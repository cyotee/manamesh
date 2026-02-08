# Progress Log: MM-035

## Current Checkpoint

**Last checkpoint:** Smart contracts and frontend types complete
**Next step:** Generate contract bindings (optional) or mark complete
**Build status:** ✅ All contracts compile
**Test status:** ✅ 42/42 tests pass (ChipToken: 20, GameVault: 20, Counter: 2)

---

## Session Log

### 2026-02-01 - Implementation Complete

**Smart Contracts Created:**
- `contracts/src/interfaces/IChipToken.sol` - Chip token interface
- `contracts/src/ChipToken.sol` - ERC-20 + ERC-2612 permit chip token
- `contracts/src/interfaces/IGameVault.sol` - Settlement vault interface with structs
- `contracts/src/GameVault.sol` - Full escrow and settlement contract
- `contracts/src/libraries/SignatureVerifier.sol` - EIP-712 signature verification

**Tests Created:**
- `contracts/test/ChipToken.t.sol` - 20 tests for deposits, withdrawals, permit, token deposits
- `contracts/test/GameVault.t.sol` - 20 tests for join/leave, settlement, folds, withdrawals

**Frontend Types Added:**
- `packages/frontend/src/wallet/signing/types.ts` - BetTypes, HandResultTypes, FoldAuthTypes, AbandonmentTypes
- `packages/frontend/src/wallet/signing/sign.ts` - useSignBet, useSignHandResult, useSignFoldAuth, useSignAbandonment hooks

**Fixes Applied:**
- Fixed `disputeHand` to be `payable` (accepts ETH for dispute stake)
- Fixed ChipToken nonces conflict by removing IERC20Permit from IChipToken
- Fixed SignatureVerifier type hashes (invalid hex → keccak256 at compile time)
- Fixed ChipToken permit test (funded signer account)
- Added DOMAIN_SEPARATOR() public function to GameVault for verification

### 2026-02-01 - In-Session Work Started

- Task started via /backlog:work
- Working directly in current session (no worktree)
- Dependencies complete: MM-034 (Wallet Integration), MM-036 (Foundry Setup)
- Ready to begin implementation

---

### 2026-01-31 - Task Created

- Task designed via /design
- TASK.md populated with requirements
- Ready for agent assignment via /backlog:launch

### Design Decisions

**Atomic Units:**
- Hand = batch of bets (atomic settlement unit)
- Game = batch of hands (session container)
- This avoids verifying individual bets on-chain unless disputed

**Signature Types:**
| Type | Purpose | When Signed |
|------|---------|-------------|
| Bet | Individual action | During gameplay |
| HandResult | Hand outcome consensus | End of each hand |
| FoldAuth | Delegation to remaining players | When folding |
| Abandonment | Claim absent player's stake | After timeout |

**Settlement Paths:**
1. Happy path: All players online → All sign HandResult → Batch settle
2. Fold path: Player folds → Signs FoldAuth → Others settle without them
3. Abandonment: Player disconnects → Timeout → Others claim stake

### Key Architecture Choices

1. **ChipToken abstraction** - Unified currency across all games
2. **ERC-2612 permit** - Gasless deposits and escrow
3. **Bet chaining via previousBetHash** - Tamper-evident action history
4. **Timeout-based abandonment** - No oracle needed
5. **Dispute as exception path** - Only replay bets when fraud claimed
