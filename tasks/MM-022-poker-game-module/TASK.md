# Task MM-022: Poker Game Module (with Crypto Integration)

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-21
**Updated:** 2026-01-26
**Dependencies:** MM-019, MM-020, MM-018, MM-029
**Worktree:** `feature/game-poker`

---

## Description

Implement the Poker game module (Texas Hold'em variant) with full cryptographic integration. This includes both a standard (trusted server) version and a crypto version using mental poker for P2P play. The task also requires extending the CryptoPlugin to support Poker-specific mechanics: shared deck dealing, hole card self-reveal, zone visibility types, and fold state tracking.

## Dependencies

- MM-019: Core Game Module Interface
- MM-020: Deck Plugin for boardgame.io
- MM-018: Standard Playing Cards Asset Pack
- MM-029: Cryptographic Deck Plugin (Mental Poker)

## User Stories

### US-MM-022.1: Standard Poker Game Play

As a player, I want to play Poker so that I can validate shared deck and betting phases.

**Acceptance Criteria:**
- [ ] Module exports boardgame.io Game object
- [ ] Shared deck for all players
- [ ] Deal 2 hole cards to each player
- [ ] Community cards: flop (3), turn (1), river (1)
- [ ] Betting rounds between deals
- [ ] Basic moves: fold, check, call, raise
- [ ] Hand comparison at showdown
- [ ] Uses DeckPlugin for card operations
- [ ] Zones: deck (shared/hidden), hand (owner-only), community (public), discard (public)
- [ ] Works with Standard Playing Cards asset pack
- [ ] Tests cover game flow

### US-MM-022.2: Crypto Poker (Mental Poker Integration)

As a player in a P2P game, I want cryptographic fairness so that no one can cheat.

**Acceptance Criteria:**
- [ ] CryptoPokerGame with mental poker encryption
- [ ] Key exchange phase at game start
- [ ] Sequential encryption phase (each player encrypts deck)
- [ ] Sequential shuffle phase with proofs
- [ ] Encrypted dealing to hand zones and community zone
- [ ] Hole card self-reveal (player decrypts their own layer to peek)
- [ ] Other players notified when someone peeks at their cards
- [ ] Option for automatic hole card reveal on deal
- [ ] Community cards revealed collaboratively (all players decrypt)
- [ ] Showdown reveals only active (non-folded) players' cards
- [ ] Folded players can optionally reveal their cards (show bluff)
- [ ] Tests cover crypto flow

### US-MM-022.3: CryptoPlugin Enhancements

As a game developer, I want enhanced crypto plugin features to support Poker's unique requirements.

**Acceptance Criteria:**
- [ ] `dealToZone(fromZone, toZone, count)` - Batch deal cards to a zone (for community)
- [ ] `dealToPlayers(fromZone, playerZones, count)` - Deal N cards to each player's zone
- [ ] `selfDecrypt(zoneId, cardIndex, playerId, privateKey)` - Decrypt only the player's own layer (for peeking)
- [ ] Zone visibility metadata: 'public' (community), 'owner-only' (hand), 'hidden' (deck)
- [ ] Fold state tracking in crypto state (which players are folded)
- [ ] `setPlayerFolded(playerId, folded)` - Mark player as folded
- [ ] `getActivePlayers()` - Returns non-folded player IDs
- [ ] Reveal behavior respects fold state (folded players excluded from mandatory reveals)
- [ ] Tests cover new plugin features

### US-MM-022.4: Hole Card Visibility

As a player, I want my hole cards visible only to me until showdown.

**Acceptance Criteria:**
- [ ] Hole cards dealt as encrypted blobs (2 layers)
- [ ] `peekHoleCards` move: player decrypts their own layer
- [ ] After peek, cards have 1 layer remaining (others still can't see)
- [ ] At showdown, active players collaboratively reveal (removes final layer)
- [ ] Folded players' cards stay encrypted (optional reveal)
- [ ] Other players see notification: "Player X peeked at their cards"
- [ ] Config option: `autoRevealHoleCards: boolean` - auto-peek on deal

### US-MM-022.5: Hand Ranking

As a game, I want correct poker hand evaluation for showdown.

**Acceptance Criteria:**
- [ ] Evaluate 5-card hands from 7 available (2 hole + 5 community)
- [ ] Hand rankings: high card < pair < two pair < three of a kind < straight < flush < full house < four of a kind < straight flush < royal flush
- [ ] Tie-breaking with kickers
- [ ] Tests cover all hand types and edge cases

## Technical Details

### Game State (Standard)

```typescript
interface PokerState {
  deck: PokerCard[];           // Shared deck
  community: PokerCard[];      // Community cards (flop, turn, river)
  pot: number;
  currentBet: number;
  players: Record<string, PokerPlayerState>;
  dealer: string;
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  bettingRound: BettingRoundState;
}

interface PokerPlayerState {
  hand: PokerCard[];       // Hole cards
  chips: number;
  bet: number;
  folded: boolean;
  hasActed: boolean;
}
```

### Game State (Crypto)

```typescript
interface CryptoPokerState extends Omit<PokerState, 'players' | 'phase'> {
  players: Record<string, CryptoPokerPlayerState>;
  phase: 'keyExchange' | 'encrypt' | 'shuffle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'gameOver';
  crypto: CryptoPluginState;
  cardIds: string[];
  playerOrder: string[];
  setupPlayerIndex: number;
}

interface CryptoPokerPlayerState extends PokerPlayerState {
  publicKey: string | null;
  hasEncrypted: boolean;
  hasShuffled: boolean;
  hasPeeked: boolean;        // Whether they've revealed their hole cards to themselves
}
```

### CryptoPlugin Enhancements

```typescript
// New types
interface ZoneMetadata {
  visibility: 'public' | 'owner-only' | 'hidden';
  owner?: string;  // For owner-only zones
}

// New state additions
interface CryptoPluginState {
  // ... existing fields ...
  zoneMetadata: Record<ZoneId, ZoneMetadata>;
  foldedPlayers: string[];
  peekNotifications: Array<{ playerId: string; timestamp: number }>;
}

// New API methods
interface CryptoPluginApi {
  // ... existing methods ...

  // Batch dealing
  dealToZone(fromZone: ZoneId, toZone: ZoneId, count: number): void;
  dealToPlayers(fromZone: ZoneId, playerZonePrefix: string, count: number): void;

  // Self-decrypt (for peeking)
  selfDecrypt(zoneId: ZoneId, cardIndex: number, playerId: string, privateKey: string): void;

  // Zone visibility
  setZoneVisibility(zoneId: ZoneId, metadata: ZoneMetadata): void;
  getZoneVisibility(zoneId: ZoneId): ZoneMetadata | null;

  // Fold tracking
  setPlayerFolded(playerId: string, folded: boolean): void;
  isPlayerFolded(playerId: string): boolean;
  getActivePlayers(): string[];

  // Peek notifications
  notifyPeek(playerId: string): void;
  getPeekNotifications(): Array<{ playerId: string; timestamp: number }>;
  clearPeekNotifications(): void;
}
```

### Phases

1. **keyExchange**: Players submit public keys
2. **encrypt**: Sequential deck encryption
3. **shuffle**: Sequential shuffle with proofs
4. **preflop**: Deal hole cards, first betting round
5. **flop**: Deal 3 community cards, betting round
6. **turn**: Deal 1 community card, betting round
7. **river**: Deal 1 community card, final betting
8. **showdown**: Reveal hands, compare, award pot

### Zones

| Zone | Visibility | Shared | Crypto Behavior |
|------|------------|--------|-----------------|
| deck | hidden | yes | Encrypted until dealt |
| hand_{playerId} | owner-only | no | Owner can self-decrypt (peek), full reveal at showdown |
| community | public | yes | Collaborative reveal when dealt |
| discard | public | yes | Burned cards (stay encrypted) |
| mucked | hidden | yes | Folded hands (optional reveal) |

### Card Reveal Flow

**Hole Cards:**
```
Deal: deck → hand_player0 (encrypted, layers=2)
Peek: player0 calls selfDecrypt → layers=1 (only player0 can read)
Showdown: all active players collaboratively decrypt → layers=0 (everyone sees)
```

**Community Cards:**
```
Deal: deck → community (encrypted, layers=2)
Reveal: all players collaboratively decrypt → layers=0 (public)
```

**Folded Hand:**
```
Fold: hand remains encrypted in hand_player0
End of hand: optionally move to mucked zone (stays encrypted)
OR: player can call "show" move to voluntarily reveal
```

## Files to Create/Modify

**New (Poker Module):**
- `packages/frontend/src/game/modules/poker/index.ts`
- `packages/frontend/src/game/modules/poker/types.ts`
- `packages/frontend/src/game/modules/poker/game.ts` - Standard Poker
- `packages/frontend/src/game/modules/poker/crypto.ts` - Crypto Poker
- `packages/frontend/src/game/modules/poker/hands.ts` - Hand ranking logic
- `packages/frontend/src/game/modules/poker/betting.ts` - Betting round logic

**Modified (CryptoPlugin):**
- `packages/frontend/src/crypto/plugin/crypto-plugin.ts` - Add batch dealing, self-decrypt, zone metadata, fold tracking

**Tests:**
- `packages/frontend/src/game/modules/poker/game.test.ts`
- `packages/frontend/src/game/modules/poker/crypto.test.ts`
- `packages/frontend/src/game/modules/poker/hands.test.ts`
- `packages/frontend/src/crypto/plugin/crypto-plugin.test.ts` - Add tests for new features

## Inventory Check

Before starting, verify:
- [ ] MM-019 complete (Core Game Module Interface)
- [ ] MM-020 complete (Deck Plugin)
- [ ] MM-018 complete (Standard Playing Cards)
- [ ] MM-029 complete (CryptoPlugin)
- [ ] War crypto integration (MM-030) reviewed for patterns

## Completion Criteria

- [ ] All acceptance criteria met
- [ ] Standard Poker playable to showdown
- [ ] Crypto Poker playable with full mental poker protocol
- [ ] CryptoPlugin enhanced with new features
- [ ] Hand ranking works correctly for all hand types
- [ ] Hole card peek/reveal flow works
- [ ] Fold state properly tracked and respected
- [ ] Tests pass
- [ ] Build succeeds

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
