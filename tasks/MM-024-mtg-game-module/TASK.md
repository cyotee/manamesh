# Task MM-024: MTG Game Module (Crypto-Aware)

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-21
**Updated:** 2026-02-08
**Dependencies:** MM-019, MM-020, MM-029
**Worktree:** `feature/game-mtg`

---

## Description

Implement a Magic: The Gathering game module with full cooperative decryption/reencryption support for deck manipulation. MTG is the most complex game in the platform, requiring mid-game deck operations (scry, tutor, mill) that go beyond the existing "encrypt-once" model.

This task also includes:
1. **Extracting shared game infrastructure** (visibility state machine, proof chain) from the One Piece module into `game/modules/shared/` so both One Piece and MTG (and future modules) import from one place.
2. **Building a general-purpose re-encryption protocol** in the shared crypto layer.
3. **Fixing the MTGCard stub** in `game/modules/types.ts` to match real-world data types.

The design philosophy is **trust-based** (same as One Piece): players request actions freely without card-text enforcement. The crypto layer ensures deck secrecy (no one sees cards they shouldn't) while players self-enforce game rules.

## Dependencies

- MM-019: Core Game Module Interface (archived, complete)
- MM-020: Deck Plugin for boardgame.io (archived, complete)
- MM-029: Cryptographic Deck Plugin / Mental Poker (archived, complete)

## Reference Implementation

**The One Piece module (MM-023) is the primary reference.** Follow its patterns for:
- Module file structure (types, zones, game, visibility, proofChain, protocol files)
- Move pattern: validate -> mutate state -> transition visibility -> syncZones -> return G
- GameModule export conforming to `GameModule<MTGCard, MTGState>` interface
- boardgame.io Game definition with `setup`, `phases`, `moves`, `endIf`
- Barrel exports from `index.ts` (export everything for testability)

**Key files to study:**
- `game/modules/onepiece/game.ts` — Move structure, state management, syncZones pattern
- `game/modules/onepiece/visibility.ts` — 6-state visibility machine (extract this)
- `game/modules/onepiece/proofChain.ts` — Proof chain system (extract this)
- `game/modules/onepiece/peek.ts` — Cooperative deck peek protocol (reference for scry)
- `game/modules/onepiece/types.ts` — Type organization pattern
- `crypto/mental-poker/sra.ts` — Existing `reencryptDeck()` (single-player; extend to multi-player)

## User Stories

### US-024.0: Extract Shared Game Infrastructure

As a developer, I want visibility and proof chain logic in a shared module so that all game modules use the same battle-tested code.

**What to extract:**
- `game/modules/onepiece/visibility.ts` -> `game/modules/shared/visibility.ts`
- `game/modules/onepiece/proofChain.ts` -> `game/modules/shared/proofChain.ts`
- Related types from `onepiece/types.ts` -> `game/modules/shared/types.ts`:
  - `CardVisibilityState`, `CardStateTransition`, `CryptographicProof`, `ProofChainEntry`
  - Any types used by visibility and proofChain functions

**What to update:**
- `game/modules/onepiece/*.ts` — Change imports to use `../shared/` instead of local
- `game/modules/onepiece/types.ts` — Remove extracted types, re-export from shared
- `game/modules/types.ts` — Fix `MTGCard` stub (see Technical Details)

**Acceptance Criteria:**
- [ ] `game/modules/shared/visibility.ts` exists with all 6-state visibility logic
- [ ] `game/modules/shared/proofChain.ts` exists with proof chain creation/verification
- [ ] `game/modules/shared/types.ts` exports shared types (CardVisibilityState, CryptographicProof, etc.)
- [ ] `game/modules/shared/index.ts` barrel exports everything
- [ ] One Piece module imports from `../shared/` — no functional changes
- [ ] All existing One Piece tests still pass (zero regressions)
- [ ] `MTGCard` in `game/modules/types.ts` updated: `power`/`toughness`/`loyalty` -> `string | null`, add `cmc`, `supertypes`, `colors`, `colorIdentity`

### US-024.1: General-Purpose Re-encryption Protocol

As a game developer, I want a reusable cooperative re-encryption protocol so that any game module can shuffle cards back into an encrypted deck mid-game.

**Acceptance Criteria:**
- [ ] `ReencryptionProtocol` in shared crypto layer (`crypto/mental-poker/reencrypt.ts`)
- [ ] Supports 2-4 players (sequential encryption layers)
- [ ] Fresh SRA key pair generation per reshuffle cycle
- [ ] Protocol steps: `requestReshuffle` -> players send new public keys -> sequential re-encrypt -> commit-reveal RNG -> deterministic shuffle
- [ ] Interleaved strip + re-encrypt: each player strips OLD layer then adds NEW layer (cards never fully plaintext)
- [ ] Batch operations: accepts array of card ciphertexts, returns re-encrypted array
- [ ] Proof chain entries for every re-encryption event
- [ ] Unit tests covering 2-player and 4-player re-encryption round trips

### US-024.2: Scry (Peek + Reorder to Top/Bottom)

As an MTG player, I want to look at the top X cards of my library and place any number on top (in order) and the rest on bottom (in order) so that I can perform scry-like abilities.

**Protocol:** (follows One Piece peek pattern from `peek.ts`)
1. Owner requests scry(X)
2. All opponents provide batch decryption shares for top X cards
3. Owner decrypts, sees X cards
4. Owner selects which cards go to top (with order) and which go to bottom (with order)
5. Selected cards are placed; they remain `owner-known` (owner can track positions)
6. No re-encryption needed (cards stay in same deck, just reordered)

**Implementation notes:**
- Model as a multi-step protocol object (like `DeckPeekProtocol` in One Piece)
- Store active scry protocols in `MTGState.activeProtocols`
- Use `batchTransitionVisibility()` for the decrypted cards

**Acceptance Criteria:**
- [ ] `requestScry(playerId, count)` move
- [ ] Multi-step protocol: request -> acks -> decrypt -> reorder -> complete
- [ ] Opponents see: "Player scried X cards, placed Y on top, Z on bottom"
- [ ] Owner retains knowledge of placed card positions until a reshuffle event
- [ ] Cards placed on top/bottom remain `owner-known` visibility state
- [ ] Works with 2-4 players (all non-owner players provide decryption shares)
- [ ] Proof chain entry records count, top/bottom split (not card identities)

### US-024.3: Tutor (Search Deck + Shuffle Remaining)

As an MTG player, I want to search my entire library for a card, put it in my hand, then shuffle my library so that I can perform tutor effects.

**Protocol (Full Cooperative Decrypt + Re-encrypt):**
1. Owner requests tutor
2. All opponents provide batch decryption shares for entire library (N cards)
3. Owner decrypts all cards locally, selects one, moves to hand (`owner-known`)
4. Remaining N-1 cards undergo **re-encryption protocol** (US-024.1):
   - All players generate fresh key pairs
   - Interleaved strip + re-encrypt (each player strips OLD, adds NEW)
   - Commit-reveal RNG seed agreement
   - Deterministic shuffle with combined seed
5. All remaining library cards transition to `encrypted` (owner loses position knowledge)

**Acceptance Criteria:**
- [ ] `requestTutor(playerId)` move
- [ ] Multi-step protocol coordinating decrypt + re-encrypt phases
- [ ] Opponents never see any card identities (only ciphertext intermediates)
- [ ] Selected card moves to hand zone with `owner-known` visibility
- [ ] Remaining library is fully re-encrypted and reshuffled
- [ ] Owner can no longer determine position of any library card after reshuffle
- [ ] All `owner-known` cards in library cleared by reshuffle
- [ ] Performance target: < 1 second for 40-card deck (batched network ops)
- [ ] Proof chain records: tutor occurred, card count before/after, reshuffle proof

### US-024.4: Mill (Opponent-Requested Top-of-Deck to Zone)

As an MTG player, I want to request my opponent move X cards from the top of their library to their graveyard or exile so that I can perform mill effects.

**Protocol:**
1. Requesting player declares mill(targetPlayer, count, destinationZone)
2. Both/all players cooperatively decrypt the top X cards
3. Cards move to destination zone with visibility determined by zone:
   - **Graveyard**: `public` (both players see card identities)
   - **Exile face-up**: `public`
   - **Exile face-down**: `owner-known` (only the card owner sees them)
4. No re-encryption needed (cards leave the library permanently)

**Acceptance Criteria:**
- [ ] `requestMill(requestingPlayer, targetPlayer, count, destination)` move
- [ ] Multi-step protocol (request -> acks -> decrypt -> move)
- [ ] Destination zone determines card visibility (graveyard=public, exile=configurable)
- [ ] Face-down exile supported (`owner-known` state)
- [ ] Works when either player requests mill of either player's deck
- [ ] Proof chain records: mill count, destination zone, card identities (for public zones only)

### US-024.5: Owner-Known Persistence Until Reshuffle

As an MTG player, when I scry cards to the top of my library, I want to see those positions in my library view until something forces a reshuffle.

**Acceptance Criteria:**
- [ ] Cards placed via scry retain `owner-known` visibility state
- [ ] Owner's library view shows decrypted identities for `owner-known` cards at their positions
- [ ] When a reshuffle event occurs (tutor, forced shuffle), ALL library cards transition to `encrypted`
- [ ] After reshuffle, owner can no longer see any previously known card positions
- [ ] Multiple scry operations accumulate knowledge (scry 3 then scry 2 = up to 5 known cards)
- [ ] Drawing a known card removes it from the known set normally

### US-024.6: MTG Game Rules & Phases

As an MTG player, I want the basic game structure (phases, zones, combat, mana, life) so that I can play a match.

**Acceptance Criteria:**
- [ ] Module exports boardgame.io `Game` object via `GameModule` interface
- [ ] `MTGCard` extends `CoreCard` with all MTG fields (see Card Schema below)
- [ ] Mana system: 5 colors (WUBRG) + colorless + generic, cost parsing
- [ ] Card types: Land, Creature, Instant, Sorcery, Enchantment, Artifact, Planeswalker
- [ ] Life total tracking (configurable: 20 for standard, 40 for Commander)
- [ ] Combat system: declare attackers -> declare blockers -> assign damage
- [ ] Tap/untap for permanents
- [ ] Counter support (+1/+1, -1/-1, loyalty, charge, generic named counters)
- [ ] 7 zones per player (see Zones table)
- [ ] Turn phases (see Turn Phases below)
- [ ] 2-4 player support (Standard 1v1 + Commander multiplayer)
- [ ] Commander zone enabled via config (off for Standard, on for Commander)
- [ ] Module registered in `game/registry.ts`
- [ ] Tests cover basic game flow, combat, mana, zone transitions

## Technical Details

### Card Schema

```typescript
// In game/modules/mtg/types.ts — the REAL MTGCard
interface MTGCard extends CoreCard {
  manaCost?: string;           // "{2}{W}{U}" Mana cost notation
  cmc: number;                 // Converted mana cost
  types: string[];             // ['Creature', 'Artifact']
  subtypes?: string[];         // ['Elf', 'Warrior']
  supertypes?: string[];       // ['Legendary', 'Snow']
  power?: string | null;       // String: MTG has *, 1+*, X, inf
  toughness?: string | null;   // String: MTG has *, 1+*, X, inf
  loyalty?: string | null;     // String: some values are non-numeric (e.g., "X")
  oracleText?: string;
  set: string;
  collectorNumber: string;
  colors: ('W' | 'U' | 'B' | 'R' | 'G')[];
  colorIdentity: ('W' | 'U' | 'B' | 'R' | 'G')[];
}
```

> **Design Note (from MM-041 research):** Scryfall, MTGJSON, and all other sources
> return `power`, `toughness`, and `loyalty` as strings. MTG has cards like Tarmogoyf
> (`*/1+*`), Infinity Elemental (`inf`), and X-cost planeswalkers. Using `string | null`
> matches the source data and avoids lossy conversion.

Also update the `MTGCard` stub in `game/modules/types.ts` to match (add `cmc`, `supertypes`, `colors`, `colorIdentity`; change `power`/`toughness`/`loyalty` to `string | null`).

### Zones

| Zone | Visibility | Ordered | Crypto Features |
|------|------------|---------|-----------------|
| library | hidden | yes | peek (scry), search (tutor), shuffle, re-encrypt |
| hand | owner-only | no | draw (decrypt to owner-known) |
| battlefield | public | no | tap/untap, counters |
| graveyard | public | yes | mill destination (decrypt to public) |
| exile | configurable | no | face-up (public) or face-down (owner-known) |
| command | public | no | Commander zone (enabled via config) |
| stack | public | yes | Spells/abilities waiting to resolve |

### Turn Phases

```
1. Beginning Phase
   a. Untap Step      -- untap all permanents (no priority)
   b. Upkeep Step     -- triggered abilities
   c. Draw Step       -- draw one card (cooperative decrypt)

2. First Main Phase   -- play lands, cast spells

3. Combat Phase
   a. Beginning of Combat
   b. Declare Attackers -- owner selects attacking creatures
   c. Declare Blockers  -- defender assigns blockers
   d. Combat Damage     -- damage assignment and resolution
   e. End of Combat

4. Second Main Phase  -- play lands, cast spells

5. End Phase
   a. End Step         -- triggered abilities
   b. Cleanup Step     -- discard to hand size, remove damage
```

### Module Configuration

```typescript
interface MTGModuleConfig {
  startingLife: number;        // Default: 20 (Standard), 40 (Commander)
  deckMinSize: number;         // Default: 60 (Standard), 100 (Commander)
  maxHandSize: number;         // Default: 7
  commanderEnabled: boolean;   // Default: false
  mulliganType: 'london';      // London mulligan
  deckEncryption: 'mental-poker';
  proofChainEnabled: boolean;  // Default: true
}
```

### Shared Infrastructure Extraction

```
game/modules/shared/
  types.ts        -- CardVisibilityState, CardStateTransition, CryptographicProof, etc.
  visibility.ts   -- 6-state visibility machine (from onepiece/visibility.ts)
  proofChain.ts   -- Proof chain creation/verification (from onepiece/proofChain.ts)
  index.ts        -- Barrel exports
```

After extraction, One Piece files change their imports:
```typescript
// Before (in onepiece/game.ts):
import { transitionCardVisibility } from './visibility';
import { appendProof } from './proofChain';

// After:
import { transitionCardVisibility } from '../shared/visibility';
import { appendProof } from '../shared/proofChain';
```

### Re-encryption Protocol (General-Purpose)

```
Participants: Players P1..Pn (2 <= n <= 4)
Input: encrypted card array C[] in zone Z
Output: re-encrypted and shuffled card array C'[] in zone Z

Phase 1 -- Key Rotation
  For each Pi:
    Generate fresh SRA key pair (ski', pki')
    Broadcast pki' to all other players
    Store ski' locally

Phase 2 -- Interleaved Strip + Re-encrypt (Sequential)
  For each Pi in round-robin:
    Pi strips their OLD layer (provides Dec_oldKey shares)
    Pi adds their NEW layer (encrypts with newKey)
  This ensures cards are never fully plaintext at any point.

Phase 3 -- Cooperative Shuffle
  Commit-reveal RNG (same as existing shuffle protocol):
    Each Pi: commit SHA256(seed_i)
    Each Pi: reveal seed_i, verify hash
    finalSeed = SHA256(stableStringify({ seeds: [...] }))
  Each Pi shuffles deterministically:
    derivedSeed_i = SHA256(finalSeed + ":" + Pi)
    C[] = deterministicShuffle(C[], derivedSeed_i)

Phase 4 -- Finalize
  All cards in Z transition to visibility: "encrypted"
  Proof chain entry with reshuffle metadata
```

### Crypto Operations for MTG

| Operation | Decrypt | Select | Re-encrypt | Shuffle |
|-----------|---------|--------|------------|---------|
| Scry X | Top X (cooperative) | Owner splits to top/bottom | No | No |
| Tutor | All N (cooperative) | Owner picks 1 to hand | Yes (N-1 remaining) | Yes |
| Mill X | Top X (cooperative) | Cards move to zone | No | No |
| Draw | Top 1 (cooperative) | Card to hand | No | No |
| Forced Shuffle | None | None | Yes (all cards) | Yes |

### Performance Targets

For a 40-card library with 2 players (batched network):

| Operation | Crypto Ops | Network Round Trips | Target Latency |
|-----------|-----------|---------------------|----------------|
| Scry 3 | 6 EC ops | 2 | < 200ms |
| Tutor | 80 EC ops + 78 re-encrypt + shuffle | 5-6 | < 1 second |
| Mill 3 | 6 EC ops | 2 | < 200ms |
| Draw 1 | 2 EC ops | 1 | < 100ms |
| Full reshuffle (40 cards) | 160 EC ops + shuffle | 5-6 | < 800ms |

## Files to Create/Modify

**New Files -- Shared Infrastructure:**
- `packages/frontend/src/game/modules/shared/types.ts` -- Shared visibility & proof types
- `packages/frontend/src/game/modules/shared/visibility.ts` -- 6-state visibility machine (extracted from One Piece)
- `packages/frontend/src/game/modules/shared/proofChain.ts` -- Proof chain system (extracted from One Piece)
- `packages/frontend/src/game/modules/shared/index.ts` -- Barrel exports

**New Files -- Shared Crypto Layer:**
- `packages/frontend/src/crypto/mental-poker/reencrypt.ts` -- General-purpose re-encryption protocol
- `packages/frontend/src/crypto/mental-poker/reencrypt.test.ts` -- Re-encryption unit tests

**New Files -- MTG Module:**
- `packages/frontend/src/game/modules/mtg/index.ts` -- Module entry point (GameModule export)
- `packages/frontend/src/game/modules/mtg/types.ts` -- MTGCard, MTGState, zone types, phase types, config
- `packages/frontend/src/game/modules/mtg/zones.ts` -- Zone definitions (7 zones with ZoneDefinition[])
- `packages/frontend/src/game/modules/mtg/game.ts` -- boardgame.io Game definition, moves, phases, setup
- `packages/frontend/src/game/modules/mtg/mana.ts` -- Mana parsing, color identity, cost calculations
- `packages/frontend/src/game/modules/mtg/combat.ts` -- Combat declaration, damage resolution
- `packages/frontend/src/game/modules/mtg/crypto-ops.ts` -- Scry, tutor, mill protocols (multi-step like peek.ts)
- `packages/frontend/src/game/modules/mtg/game.test.ts` -- Game flow + combat tests
- `packages/frontend/src/game/modules/mtg/crypto-ops.test.ts` -- Crypto operations tests
- `packages/frontend/src/game/modules/mtg/mana.test.ts` -- Mana system tests

**Modified Files:**
- `packages/frontend/src/game/modules/types.ts` -- Fix MTGCard stub (string|null, add colors, colorIdentity, cmc, supertypes)
- `packages/frontend/src/game/modules/onepiece/types.ts` -- Remove extracted shared types, re-export from shared
- `packages/frontend/src/game/modules/onepiece/game.ts` -- Update imports to use ../shared/
- `packages/frontend/src/game/modules/onepiece/peek.ts` -- Update imports to use ../shared/
- `packages/frontend/src/game/modules/onepiece/index.ts` -- Update re-exports
- `packages/frontend/src/game/registry.ts` -- Add MTG entry
- `packages/frontend/src/crypto/mental-poker/types.ts` -- Add ReencryptionRequest, ReencryptionPhase types
- `packages/frontend/src/crypto/mental-poker/index.ts` -- Export reencrypt module

## Implementation Order

1. **Extract shared infrastructure** (US-024.0)
   - Create `game/modules/shared/` with visibility + proofChain
   - Update One Piece imports
   - Fix MTGCard stub in types.ts
   - Run One Piece tests (must all pass)

2. **Build re-encryption protocol** (US-024.1)
   - Create `crypto/mental-poker/reencrypt.ts`
   - Unit tests for 2-player and 4-player round trips

3. **Build MTG types, zones, config** (partial US-024.6)
   - `mtg/types.ts`, `mtg/zones.ts`

4. **Build mana system** (partial US-024.6)
   - `mtg/mana.ts` + tests

5. **Build game.ts with basic moves** (US-024.6)
   - Setup, draw, play, discard, tap/untap, life tracking
   - Turn phases, combat (`mtg/combat.ts`)
   - Register in game registry

6. **Build crypto operations** (US-024.2, 024.3, 024.4, 024.5)
   - `mtg/crypto-ops.ts` with scry, tutor, mill protocols
   - Owner-known persistence logic
   - Integration tests

## Inventory Check

Before starting, verify:
- [ ] `packages/frontend/src/crypto/mental-poker/sra.ts` exists and exports `encryptDeck`, `reencryptDeck`, `decryptCard`
- [ ] `packages/frontend/src/crypto/mental-poker/commitment.ts` exists for SHA256 commitment utilities
- [ ] `packages/frontend/src/game/plugins/deck.ts` exports `DeckPlugin`, `DeckPluginApi`, `moveCard`, `moveTop`
- [ ] `packages/frontend/src/game/modules/types.ts` exports `GameModule`, `CoreCard`, `ZoneDefinition`
- [ ] `packages/frontend/src/game/modules/onepiece/visibility.ts` exists (will extract)
- [ ] `packages/frontend/src/game/modules/onepiece/proofChain.ts` exists (will extract)
- [ ] `packages/frontend/src/game/modules/onepiece/peek.ts` exists (reference for scry protocol)
- [ ] `packages/frontend/src/game/modules/gofish/crypto.ts` exists (reference for multi-player setup + shuffle)
- [ ] All existing tests pass (`yarn test`)

## Completion Criteria

- [ ] Shared infrastructure extracted and One Piece tests still pass
- [ ] MTGCard stub in types.ts updated with correct types
- [ ] Re-encryption protocol works for 2, 3, and 4 players
- [ ] All acceptance criteria in US-024.0 through US-024.6 met
- [ ] Scry correctly preserves owner-known cards until reshuffle
- [ ] Tutor + reshuffle removes all owner-known visibility from library
- [ ] Mill respects zone-based visibility (graveyard=public, exile face-down=owner-known)
- [ ] Commander format works (100-card, 40 life, commander zone)
- [ ] Standard format works (60-card, 20 life, no commander zone)
- [ ] Module registered in game registry
- [ ] All tests pass (existing + new)
- [ ] Build succeeds (`yarn build`)
- [ ] No regressions in existing game modules (especially One Piece)

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
