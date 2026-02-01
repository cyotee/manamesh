# Progress Log: MM-035

## Current Checkpoint

**Last checkpoint:** Not started
**Next step:** Read TASK.md and begin implementation
**Build status:** ⏳ Not checked
**Test status:** ⏳ Not checked

---

## Session Log

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
