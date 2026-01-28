# Task MM-022: Poker Game Module (with Crypto Integration)

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-21
**Updated:** 2026-01-26
**Dependencies:** MM-019, MM-020, MM-018, MM-029
**Worktree:** `feature/game-poker`

---

## Description

Implement the Poker game module (Texas Hold'em variant) with full cryptographic integration. This includes both a standard (trusted server) version and a crypto version using mental poker for P2P play. The task also requires extending the CryptoPlugin to support Poker-specific mechanics: shared deck dealing, hole card self-reveal, zone visibility types, fold state tracking, and **player abandonment support** (key release on fold, threshold key escrow, disconnect handling).

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

### US-MM-022.6: Key Release on Fold

As a folded player, I want to release my encryption key so that I can leave the game without blocking other players.

**Acceptance Criteria:**
- [ ] When player folds, they MUST release their private key
- [ ] Optional "show hand" action available BEFORE key release (for bluff reveals)
- [ ] Released keys stored in game state (`releasedKeys` map)
- [ ] All remaining players receive and store the released key
- [ ] Reveals use released keys for absent players (no participation needed)
- [ ] Folded player can safely disconnect after key release
- [ ] Folded player's hand remains protected (other layers still encrypt it)
- [ ] Tests cover fold → key release → leave → reveal sequence

### US-MM-022.7: Threshold Key Escrow

As a player, I want key escrow so that disconnected players don't permanently block the game.

**Acceptance Criteria:**
- [ ] Key escrow phase added after key exchange
- [ ] Each player splits their private key using Shamir's Secret Sharing
- [ ] Shares distributed to all other players (N-1 shares per key)
- [ ] Configurable threshold K (default: N-1, meaning any N-1 players can reconstruct)
- [ ] Shares encrypted for recipient before transmission
- [ ] Key reconstruction triggered when player disconnects without releasing key
- [ ] Reconstructed keys functionally equivalent to released keys
- [ ] Tests cover share distribution and threshold reconstruction

### US-MM-022.8: Disconnect Handling

As a remaining player, I want the game to continue when someone disconnects.

**Acceptance Criteria:**
- [ ] Heartbeat/ping mechanism detects disconnections (5s interval, 15s threshold)
- [ ] Action timeout triggers auto-fold (30s default, configurable)
- [ ] Auto-fold attempts to get key release from disconnected player
- [ ] If no key release within timeout, attempt threshold reconstruction
- [ ] Game viability check after each disconnect:
  - Can remaining keys reveal community cards?
  - Can remaining keys reveal active players' hands at showdown?
- [ ] If game not viable (below threshold), void hand and return bets
- [ ] Disconnected player can rejoin as spectator (no game impact)
- [ ] Tests cover disconnect scenarios at each game phase

### US-MM-022.9: Game Viability Check

As a game, I want to detect when the game cannot continue fairly.

**Acceptance Criteria:**
- [ ] `checkGameViability()` returns 'continue' or 'void'
- [ ] Viability requires:
  - All encryption layers removable for community cards
  - All encryption layers removable for active players' hands
- [ ] Available keys = released keys + active players + reconstructable keys
- [ ] If viability check fails, game enters 'voided' state
- [ ] Voided games return all bets to players proportionally
- [ ] Voided game state preserved for audit/logging
- [ ] Tests cover viability edge cases

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
  phase: 'keyExchange' | 'keyEscrow' | 'encrypt' | 'shuffle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'gameOver' | 'voided';
  crypto: CryptoPluginState;
  cardIds: string[];
  playerOrder: string[];
  setupPlayerIndex: number;

  // Abandonment support
  releasedKeys: Record<string, string>;           // playerId → privateKey (from folds)
  keyEscrowShares: Record<string, Record<string, string>>;  // playerId → { recipientId → encryptedShare }
  escrowThreshold: number;                        // K value for K-of-N reconstruction
  disconnectedPlayers: string[];                  // Players who disconnected without key release
  lastHeartbeat: Record<string, number>;          // playerId → timestamp
}

interface CryptoPokerPlayerState extends PokerPlayerState {
  publicKey: string | null;
  hasEncrypted: boolean;
  hasShuffled: boolean;
  hasPeeked: boolean;           // Whether they've revealed their hole cards to themselves
  hasReleasedKey: boolean;      // Whether they've released their key (after fold)
  hasDistributedShares: boolean; // Whether they've distributed escrow shares
  isConnected: boolean;         // Connection status
}
```

### CryptoPlugin Enhancements

```typescript
// New types
interface ZoneMetadata {
  visibility: 'public' | 'owner-only' | 'hidden';
  owner?: string;  // For owner-only zones
}

interface KeyShare {
  fromPlayer: string;
  forPlayer: string;
  encryptedShare: string;  // Encrypted with recipient's public key
  shareIndex: number;
}

// New state additions
interface CryptoPluginState {
  // ... existing fields ...
  zoneMetadata: Record<ZoneId, ZoneMetadata>;
  foldedPlayers: string[];
  peekNotifications: Array<{ playerId: string; timestamp: number }>;

  // Abandonment support
  releasedKeys: Record<string, string>;
  keyEscrowShares: Record<string, KeyShare[]>;  // playerId → shares of their key
  escrowThreshold: number;
  disconnectedPlayers: string[];
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

  // Key release (for fold abandonment)
  releaseKey(playerId: string, privateKey: string): void;
  hasReleasedKey(playerId: string): boolean;
  getReleasedKey(playerId: string): string | null;
  getAllAvailableKeys(): Record<string, string>;  // Released + active players' keys

  // Key escrow (for disconnect recovery)
  setEscrowThreshold(k: number): void;
  getEscrowThreshold(): number;
  storeKeyShare(share: KeyShare): void;
  getKeyShares(playerId: string): KeyShare[];
  reconstructKey(playerId: string): string | null;  // Returns null if below threshold
  canReconstructKey(playerId: string): boolean;

  // Disconnect handling
  markDisconnected(playerId: string): void;
  markReconnected(playerId: string): void;
  isDisconnected(playerId: string): boolean;
  getDisconnectedPlayers(): string[];

  // Game viability
  checkGameViability(): 'continue' | 'void';
  getAvailableKeyCount(): number;
  getRequiredKeyCount(): number;

  // Decryption with fallback (uses released/reconstructed keys)
  decryptWithFallback(
    encryptedCard: EncryptedCard,
    activeDecryptors: string[]  // Players providing live decryption
  ): DecryptedCard | null;
}
```

### Phases

1. **keyExchange**: Players submit public keys
2. **keyEscrow**: Players distribute threshold key shares (for abandonment recovery)
3. **encrypt**: Sequential deck encryption
4. **shuffle**: Sequential shuffle with proofs
5. **preflop**: Deal hole cards, first betting round
6. **flop**: Deal 3 community cards, betting round
7. **turn**: Deal 1 community card, betting round
8. **river**: Deal 1 community card, final betting
9. **showdown**: Reveal hands, compare, award pot
10. **gameOver**: Pot awarded, hand complete
11. **voided**: Game unrecoverable, bets returned

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

### Player Abandonment Workflow

**Key Escrow Setup (during keyEscrow phase):**
```
For N=4 players, threshold K=3:

Alice splits privA into 4 shares using Shamir's Secret Sharing:
  share_A0 (Alice keeps, optional)
  share_A1 → encrypted for Bob
  share_A2 → encrypted for Carol
  share_A3 → encrypted for Dave

All players do the same. Result: Any 3 players can reconstruct any key.
```

**Fold Flow (voluntary departure):**
```
1. Carol decides to fold
2. Carol optionally calls "showHand" (reveals bluff before leaving)
3. Carol calls "fold" move:
   a. Mark Carol as folded
   b. Carol broadcasts privateKey to all players
   c. Store in releasedKeys['carol']
4. Carol can safely disconnect
5. Future reveals use releasedKeys['carol'] instead of Carol's participation
```

**Disconnect Flow (involuntary departure):**
```
1. Dave stops responding (no heartbeat for 15s)
2. Dave's turn times out (30s)
3. Auto-fold triggered for Dave
4. Attempt to get key release (Dave may be AFK, not disconnected)
5. If no response:
   a. Mark Dave as disconnected
   b. Gather key shares from Alice, Bob, Carol
   c. If 3+ shares available: reconstruct Dave's key
   d. Store reconstructed key in releasedKeys['dave']
6. Continue game with reconstructed key
7. If reconstruction fails (< threshold shares): check game viability
```

**Game Viability Check:**
```
Available keys = {
  active players (can decrypt live),
  released keys (from folds),
  reconstructable keys (from escrow)
}

Required for community reveals: ALL player keys
Required for showdown: ALL player keys EXCEPT the hand owner (owner peeked)

If required keys unavailable:
  → phase = 'voided'
  → Return bets proportionally
  → Log game state for audit
```

### Timeout Configuration

```typescript
const TIMEOUT_CONFIG = {
  heartbeatInterval: 5_000,      // Ping every 5 seconds
  disconnectThreshold: 15_000,   // 3 missed heartbeats = disconnect
  actionTimeout: 30_000,         // 30 seconds to act before auto-fold
  keyReleaseTimeout: 10_000,     // 10 seconds to release key after fold
  reconstructionTimeout: 5_000,  // 5 seconds to gather shares
};
```

### Abandonment State Diagram

```
                    ┌─────────────┐
                    │   ACTIVE    │
                    │   PLAYER    │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │    FOLD     │ │  DISCONNECT │ │   TIMEOUT   │
    │ (voluntary) │ │ (detected)  │ │  (no action)│
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           ▼               │               │
    ┌─────────────┐        │               │
    │   RELEASE   │        │               │
    │     KEY     │◄───────┴───────────────┘
    └──────┬──────┘        │
           │               │ (no response)
           │               ▼
           │        ┌─────────────┐
           │        │ RECONSTRUCT │
           │        │     KEY     │
           │        └──────┬──────┘
           │               │
           │    ┌──────────┴──────────┐
           │    │                     │
           │    ▼                     ▼
           │  ┌─────────────┐  ┌─────────────┐
           │  │   SUCCESS   │  │   FAILED    │
           │  │ (key avail) │  │ (< threshold)│
           │  └──────┬──────┘  └──────┬──────┘
           │         │                │
           ▼         ▼                ▼
    ┌─────────────────────┐    ┌─────────────┐
    │   GAME CONTINUES    │    │ VIABILITY   │
    │ (with released key) │    │    CHECK    │
    └─────────────────────┘    └──────┬──────┘
                                      │
                            ┌─────────┴─────────┐
                            ▼                   ▼
                     ┌─────────────┐     ┌─────────────┐
                     │  CONTINUE   │     │    VOID     │
                     │   (viable)  │     │   (return   │
                     │             │     │    bets)    │
                     └─────────────┘     └─────────────┘
```

## Files to Create/Modify

**New (Poker Module):**
- `packages/frontend/src/game/modules/poker/index.ts`
- `packages/frontend/src/game/modules/poker/types.ts`
- `packages/frontend/src/game/modules/poker/game.ts` - Standard Poker
- `packages/frontend/src/game/modules/poker/crypto.ts` - Crypto Poker
- `packages/frontend/src/game/modules/poker/hands.ts` - Hand ranking logic
- `packages/frontend/src/game/modules/poker/betting.ts` - Betting round logic
- `packages/frontend/src/game/modules/poker/abandonment.ts` - Disconnect/timeout handling
- `packages/frontend/src/game/modules/poker/viability.ts` - Game viability checks

**New (Crypto Utilities):**
- `packages/frontend/src/crypto/shamirs/index.ts` - Shamir's Secret Sharing implementation
- `packages/frontend/src/crypto/shamirs/split.ts` - Key splitting into shares
- `packages/frontend/src/crypto/shamirs/reconstruct.ts` - Key reconstruction from shares
- `packages/frontend/src/crypto/shamirs/types.ts` - Share types

**Modified (CryptoPlugin):**
- `packages/frontend/src/crypto/plugin/crypto-plugin.ts` - Add batch dealing, self-decrypt, zone metadata, fold tracking, key release, key escrow, disconnect handling, viability checks

**Tests:**
- `packages/frontend/src/game/modules/poker/game.test.ts`
- `packages/frontend/src/game/modules/poker/crypto.test.ts`
- `packages/frontend/src/game/modules/poker/hands.test.ts`
- `packages/frontend/src/game/modules/poker/abandonment.test.ts`
- `packages/frontend/src/crypto/shamirs/shamirs.test.ts`
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
- [ ] **Key release on fold works** (folded players can leave)
- [ ] **Threshold key escrow works** (Shamir's Secret Sharing)
- [ ] **Disconnect handling works** (timeout → auto-fold → key recovery)
- [ ] **Game viability check works** (void when unrecoverable)
- [ ] **Reveals work with released/reconstructed keys**
- [ ] Tests pass
- [ ] Build succeeds

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
