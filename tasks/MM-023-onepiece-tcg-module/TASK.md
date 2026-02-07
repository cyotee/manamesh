# Task MM-023: One Piece TCG Game Module

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-21
**Updated:** 2026-01-31
**Dependencies:** MM-019, MM-020, MM-029
**Worktree:** `feature/game-onepiece`

---

## Description

Implement the One Piece Trading Card Game module as a **rules-agnostic state manager** with cooperative decryption. This module does NOT enforce game rules—it manages game state and ensures fair deck operations through cryptographic protocols. Players are responsible for following rules; the system prevents cheating on deck operations.

## Design Philosophy

| Principle | Description |
|-----------|-------------|
| Rules-Agnostic | Module manages game state only; rules enforcement is player responsibility |
| Cooperative Decryption | Both players participate in deck operations to prevent cheating |
| Verifiable State | All state transitions produce cryptographic proofs |
| Full Visibility Control | Cards can exist in multiple visibility states with tracked transitions |

## Dependencies

- MM-019: Core Game Module Interface
- MM-020: Deck Plugin for boardgame.io
- MM-029: Cryptographic Deck Plugin (Mental Poker) - for cooperative decryption

## User Stories

### US-MM-023.1: One Piece Game State Management

As a player, I want to manage One Piece TCG game state so that I can play the game with cryptographic fairness.

**Acceptance Criteria:**
- [ ] Module exports boardgame.io Game object
- [ ] OnePieceCard schema with all fields (cardType, cost, power, counter, color, attributes, trigger, effectText, set, cardNumber, rarity, life)
- [ ] OnePieceDonCard as separate card type
- [ ] All zones implemented (Main Deck, Life Deck, DON!! Deck, Trash, Hand, Play Area, DON!! Area)
- [ ] Card visibility state machine implemented
- [ ] Mental poker integration for deck encryption
- [ ] Tests cover zone transitions

### US-MM-023.2: Cooperative Deck Peeking

As a player, I want to peek at the top N cards of my Main Deck so that only I can see them while my opponent verifies the operation was fair.

**Acceptance Criteria:**
- [ ] DeckPeekRequest interface implemented
- [ ] 4-step peek protocol: request → opponent ack → owner decrypt → optional reorder
- [ ] Cards transition to 'owner-known' visibility state after peek
- [ ] Owner can reorder peeked cards before returning to deck
- [ ] All transitions produce signed proofs

### US-MM-023.3: Card Visibility State Machine

As a player, I want cards to have tracked visibility states so that both players can verify fair play.

**Acceptance Criteria:**
- [ ] CardVisibilityState type with 6 states (encrypted, public, secret, owner-known, opponent-known, all-known)
- [ ] CardStateTransition interface tracking all state changes
- [ ] Valid transitions enforced (encrypted→owner-known, owner-known→public, etc.)
- [ ] Each transition produces CryptographicProof
- [ ] Proof chain can be verified by either player

### US-MM-023.4: Play Area Slot System

As a player, I want flexible slots in my play area so that I can position Leader, Characters, and Stage cards.

**Acceptance Criteria:**
- [ ] PlayAreaSlot interface (slotType, cardId, attachedDon, position)
- [ ] Leader slot (exactly one)
- [ ] Character slots (configurable, typically 5)
- [ ] Optional Stage slot
- [ ] DON!! attachment per-slot tracking
- [ ] attachDon/detachDon operations

### US-MM-023.5: Proof Chain Auditability

As a player, I want all game actions recorded in a proof chain so that disputes can be resolved fairly.

**Acceptance Criteria:**
- [ ] CryptographicProof interface with transitionId, previousProofHash, signatures
- [ ] Proof chain links all transitions
- [ ] Both players sign each proof
- [ ] verifyProofChain function validates entire chain
- [ ] Proofs stored for dispute resolution

## Technical Details

### Card Schema

```typescript
type OnePieceCardType = 'character' | 'leader' | 'event' | 'stage' | 'don';

interface OnePieceCard extends CoreCard {
  cardType: OnePieceCardType;
  cost?: number;
  power?: number;
  counter?: number;
  color: OnePieceColor[];
  attributes?: string[];
  trigger?: string;
  effectText?: string;
  set: string;
  cardNumber: string;
  rarity: 'C' | 'UC' | 'R' | 'SR' | 'SEC' | 'L' | 'SP';
  life?: number;  // Leaders only
}

type OnePieceColor = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';

interface OnePieceDonCard extends CoreCard {
  cardType: 'don';
}
```

### Zones

| Zone | ID | Visibility | Ordered | Features |
|------|-----|------------|---------|----------|
| Main Deck | mainDeck | hidden (encrypted) | yes | peek, shuffle, search |
| Life Deck | lifeDeck | mixed per-card | yes | face-up/face-down/owner-known |
| DON!! Deck | donDeck | public | no | counter-like supply |
| Trash | trash | public | yes | search |
| Hand | hand | owner-only | no | standard hand |
| Play Area | playArea | public | no | flexible slots |
| DON!! Area | donArea | public | no | active DON!! |

### Card Visibility States

```typescript
type CardVisibilityState =
  | 'encrypted'      // Unknown to all (in shuffled deck)
  | 'public'         // Visible to all players
  | 'secret'         // Hidden from all (rare - transitional)
  | 'owner-known'    // Owner can see, opponent cannot
  | 'opponent-known' // Opponent can see, owner cannot (rare)
  | 'all-known';     // Both know but not publicly revealed
```

### Deck Peek Protocol

```typescript
interface DeckPeekRequest {
  playerId: string;
  deckZone: 'mainDeck' | 'lifeDeck';
  count: number;
  requestProof: Signature;
}

interface DeckPeekProtocol {
  request: DeckPeekRequest;
  opponentAck: { requestHash: string; decryptionShare: DecryptionShare; proof: Signature };
  ownerDecrypt: { cardStates: CardStateTransition[] };
  reorder?: { newPositions: number[]; proof: Signature };
}
```

### Module Configuration

```typescript
interface OnePieceModuleConfig {
  startingLife: number;        // Default: 5
  startingDon: number;         // Default: 10
  startingHand: number;        // Default: 5
  maxCharacterSlots: number;   // Default: 5
  allowStageCard: boolean;     // Default: true
  deckEncryption: 'mental-poker';
  proofChainEnabled: boolean;  // Default: true
}
```

## Files to Create/Modify

**New:**
- `packages/frontend/src/game/modules/onepiece/index.ts` - Module entry point
- `packages/frontend/src/game/modules/onepiece/types.ts` - Card and state types
- `packages/frontend/src/game/modules/onepiece/game.ts` - boardgame.io Game definition
- `packages/frontend/src/game/modules/onepiece/zones.ts` - Zone definitions
- `packages/frontend/src/game/modules/onepiece/visibility.ts` - Visibility state machine
- `packages/frontend/src/game/modules/onepiece/peek.ts` - Deck peek protocol
- `packages/frontend/src/game/modules/onepiece/playArea.ts` - Play area slot system
- `packages/frontend/src/game/modules/onepiece/proofChain.ts` - Cryptographic proof chain

**Tests:**
- `packages/frontend/src/game/modules/onepiece/types.test.ts`
- `packages/frontend/src/game/modules/onepiece/visibility.test.ts`
- `packages/frontend/src/game/modules/onepiece/peek.test.ts`
- `packages/frontend/src/game/modules/onepiece/playArea.test.ts`
- `packages/frontend/src/game/modules/onepiece/proofChain.test.ts`
- `packages/frontend/src/game/modules/onepiece/game.test.ts`

## Inventory Check

Before starting, verify:
- [ ] MM-019 Core Game Module Interface is implemented
- [ ] MM-020 Deck Plugin is implemented
- [ ] MM-029 Cryptographic Deck Plugin is implemented
- [ ] Mental poker encryption utilities are available

## Completion Criteria

- [ ] All acceptance criteria met for all 5 user stories
- [ ] Visibility state machine transitions correctly
- [ ] Deck peek protocol works with mental poker
- [ ] Proof chain produces verifiable proofs
- [ ] Play area slots work for Leader/Characters/Stage
- [ ] Tests pass (minimum 80% coverage on new code)
- [ ] Build succeeds
- [ ] No new compiler warnings

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
