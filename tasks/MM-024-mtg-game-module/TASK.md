# Task MM-024: MTG Game Module (Crypto-Aware)

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-21
**Updated:** 2026-02-08
**Dependencies:** MM-019, MM-020, MM-029
**Worktree:** `feature/game-mtg`

---

## Description

Implement a Magic: The Gathering game module with full cooperative decryption/reencryption support for deck manipulation. MTG is the most complex game in the platform, requiring mid-game deck operations (scry, tutor, mill) that go beyond the existing "encrypt-once" model. This task includes building a general-purpose re-encryption protocol in the shared crypto layer and the MTG-specific game logic that uses it.

The design philosophy is **trust-based**: players request actions freely without card-text enforcement. The crypto layer ensures deck secrecy (no one sees cards they shouldn't) while players self-enforce game rules.

## Dependencies

- MM-019: Core Game Module Interface (archived, complete)
- MM-020: Deck Plugin for boardgame.io (archived, complete)
- MM-029: Cryptographic Deck Plugin / Mental Poker (archived, complete)

## User Stories

### US-024.1: General-Purpose Re-encryption Protocol

As a game developer, I want a reusable cooperative re-encryption protocol so that any game module can shuffle cards back into an encrypted deck mid-game.

**Acceptance Criteria:**
- [ ] `ReencryptionProtocol` in shared crypto layer (`crypto/mental-poker/reencrypt.ts`)
- [ ] Supports 2-4 players (sequential encryption layers)
- [ ] Fresh SRA key pair generation per reshuffle cycle
- [ ] Protocol steps: `requestReshuffle` -> players send new public keys -> sequential re-encrypt -> commit-reveal RNG -> deterministic shuffle
- [ ] All previously `owner-known` cards in the target zone transition to `encrypted`
- [ ] Batch operations: accepts array of card ciphertexts, returns re-encrypted array
- [ ] Proof chain entries for every re-encryption event
- [ ] Unit tests covering 2-player and 4-player re-encryption round trips

### US-024.2: Scry (Peek + Reorder to Top/Bottom)

As an MTG player, I want to look at the top X cards of my library and place any number on top (in order) and the rest on bottom (in order) so that I can perform scry-like abilities.

**Protocol:**
1. Owner requests scry(X)
2. All opponents provide batch decryption shares for top X cards
3. Owner decrypts, sees X cards
4. Owner selects which cards go to top (with order) and which go to bottom (with order)
5. Selected cards are placed; they remain `owner-known` (owner can track their positions)
6. No re-encryption needed (cards stay in the same deck, just reordered)

**Acceptance Criteria:**
- [ ] `requestScry(playerId, count)` move
- [ ] Opponents see: "Player scried X cards, placed Y on top, Z on bottom" (count + positions visible)
- [ ] Owner retains knowledge of placed card positions until a reshuffle event
- [ ] Cards placed on top/bottom remain `owner-known` visibility state
- [ ] Works with 2-4 players (all non-owner players provide decryption shares)
- [ ] Proof chain entry records count, top/bottom split (not card identities)

### US-024.3: Tutor (Search Deck + Shuffle Remaining)

As an MTG player, I want to search my entire library for a card, put it in my hand, then shuffle my library so that I can perform tutor effects.

**Protocol (Full Cooperative Decrypt):**
1. Owner requests tutor
2. All opponents provide batch decryption shares for entire library (N cards)
3. Owner decrypts all cards locally, selects one, moves it to hand (`owner-known`)
4. Remaining N-1 cards undergo **re-encryption protocol** (US-024.1):
   - All players generate fresh key pairs
   - Sequential re-encryption (each player adds a new layer)
   - Commit-reveal RNG seed agreement
   - Deterministic shuffle with combined seed
5. All remaining library cards transition to `encrypted` (owner loses position knowledge)

**Acceptance Criteria:**
- [ ] `requestTutor(playerId)` move
- [ ] Opponents never see any card identities (only `Enc_A(card)` intermediates)
- [ ] Selected card moves to hand zone with `owner-known` visibility
- [ ] Remaining library is fully re-encrypted and reshuffled
- [ ] Owner can no longer determine position of any library card after reshuffle
- [ ] Performance target: < 1 second for 40-card deck (batched network ops)
- [ ] Proof chain records: tutor occurred, card count before/after, reshuffle proof

### US-024.4: Mill (Opponent-Requested Top-of-Deck to Zone)

As an MTG player, I want to request my opponent move X cards from the top of their library to their graveyard or exile so that I can perform mill effects.

**Protocol:**
1. Requesting player declares mill(targetPlayer, count, destinationZone)
2. Both players cooperatively decrypt the top X cards
3. Cards move to destination zone with visibility determined by zone:
   - **Graveyard**: `public` (both players see card identities)
   - **Exile face-up**: `public`
   - **Exile face-down**: `owner-known` (only the card owner sees them)
4. No re-encryption needed (cards leave the library permanently)

**Acceptance Criteria:**
- [ ] `requestMill(requestingPlayer, targetPlayer, count, destination)` move
- [ ] Destination zone determines card visibility (graveyard=public, exile=configurable)
- [ ] Face-down exile supported (`owner-known` state)
- [ ] Works when either player requests mill of either player's deck
- [ ] Proof chain records: mill count, destination zone, card identities (for public zones only)

### US-024.5: Owner-Known Persistence Until Reshuffle

As an MTG player, when I scry cards to the top of my library, I want to see those cards' positions in my library view until something forces a reshuffle, so that I can track what I know.

**Acceptance Criteria:**
- [ ] Cards placed via scry retain `owner-known` visibility state
- [ ] Owner's library view shows decrypted identities for `owner-known` cards at their positions
- [ ] When a reshuffle event occurs (e.g., tutor, forced shuffle), ALL library cards transition to `encrypted`
- [ ] After reshuffle, owner can no longer see any previously known card positions
- [ ] Multiple scry operations accumulate knowledge (scry 3 then scry 2 = up to 5 known cards)
- [ ] Drawing a known card removes it from the known set normally

### US-024.6: MTG Game Rules & Phases

As an MTG player, I want the basic game structure (phases, zones, combat, mana, life) so that I can play a match.

**Acceptance Criteria:**
- [ ] Module exports boardgame.io `Game` object via `GameModule` interface
- [ ] `MTGCard` extends `CoreCard` with MTG-specific fields (mana cost, types, subtypes, supertypes, power/toughness/loyalty as `string | null`, oracle text, colors, set, collector number)
- [ ] Mana system: 5 colors (WUBRG) + colorless + generic
- [ ] Card types: Land, Creature, Instant, Sorcery, Enchantment, Artifact, Planeswalker
- [ ] Life total tracking (default 20, configurable for Commander at 40)
- [ ] Combat system: declare attackers -> declare blockers -> assign damage
- [ ] Tap/untap for permanents
- [ ] Counter support (+1/+1, -1/-1, loyalty, charge, generic named counters)
- [ ] 7 zones per player (see Technical Details)
- [ ] Turn phases (see Technical Details)
- [ ] 2-4 player support
- [ ] Tests cover basic game flow, combat, mana, zone transitions

## Technical Details

### Card Schema

```typescript
interface MTGCard extends CoreCard {
  manaCost?: string;           // "{2}{W}{U}" Mana cost notation
  cmc: number;                 // Converted mana cost
  types: string[];             // ['Creature', 'Artifact']
  subtypes?: string[];         // ['Elf', 'Warrior']
  supertypes?: string[];       // ['Legendary', 'Snow']
  power?: string | null;       // String because MTG has *, 1+*, X, etc.
  toughness?: string | null;   // String because MTG has *, 1+*, X, etc.
  loyalty?: string | null;     // String because some values are non-numeric (e.g., "X")
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

### Zones

| Zone | Visibility | Ordered | Crypto Features |
|------|------------|---------|-----------------|
| library | hidden | yes | peek (scry), search (tutor), shuffle, re-encrypt |
| hand | owner-only | no | draw (decrypt to owner-known) |
| battlefield | public | no | tap/untap, counters |
| graveyard | public | yes | mill destination (decrypt to public) |
| exile | configurable | no | face-up (public) or face-down (owner-known) |
| command | public | no | Commander zone |
| stack | public | yes | Spells/abilities waiting to resolve |

### Turn Phases

```
1. Beginning Phase
   a. Untap Step      — untap all permanents (no priority)
   b. Upkeep Step     — triggered abilities
   c. Draw Step       — draw one card (cooperative decrypt)

2. First Main Phase   — play lands, cast spells

3. Combat Phase
   a. Beginning of Combat
   b. Declare Attackers — owner selects attacking creatures
   c. Declare Blockers  — defender assigns blockers
   d. Combat Damage     — damage assignment and resolution
   e. End of Combat

4. Second Main Phase  — play lands, cast spells

5. End Phase
   a. End Step         — triggered abilities
   b. Cleanup Step     — discard to hand size, remove damage
```

### Re-encryption Protocol (General-Purpose)

```
Participants: Players P1..Pn (2 <= n <= 4)
Input: encrypted card array C[] in zone Z
Output: re-encrypted and shuffled card array C'[] in zone Z

Phase 1 — Key Rotation
  For each Pi:
    Generate fresh SRA key pair (ski', pki')
    Broadcast pki' to all other players
    Store ski' locally (never in shared state for coop-reveal mode)

Phase 2 — Layer Stripping (Sequential)
  For each Pi in order:
    Pi provides batch decryption shares: Dec_ski(C[j]) for all j
    All players verify shares received
    C[] = applyDecryptionShares(C[], shares_i)
  Result: C[] is now fully decrypted (plaintext card points)

  NOTE: In coop-reveal mode, no single player sees plaintext.
  Each player only removes ONE layer. After P1 removes their layer,
  cards still have P2..Pn layers. After P2 removes theirs, still P3..Pn.
  Only after ALL layers removed are cards plaintext — but this happens
  as a conceptual step, not visible to any single player.

  CORRECTION: The actual protocol interleaves strip + re-encrypt:
  For each Pi in round-robin:
    Pi strips their OLD layer (provides Dec_oldKey shares)
    Pi adds their NEW layer (encrypts with newKey)
  This ensures cards are never fully plaintext at any point.

Phase 3 — Cooperative Shuffle
  Commit-reveal RNG (same as existing shuffle protocol):
    Each Pi: commit SHA256(seed_i)
    Each Pi: reveal seed_i, verify hash
    finalSeed = SHA256(stableStringify({ seeds: [...] }))

  Each Pi shuffles deterministically:
    derivedSeed_i = SHA256(finalSeed + ":" + Pi)
    C[] = deterministicShuffle(C[], derivedSeed_i)

Phase 4 — Finalize
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

**New Files — Shared Crypto Layer:**
- `packages/frontend/src/crypto/mental-poker/reencrypt.ts` — General-purpose re-encryption protocol
- `packages/frontend/src/crypto/mental-poker/reencrypt.test.ts` — Re-encryption unit tests

**New Files — MTG Module:**
- `packages/frontend/src/game/modules/mtg/index.ts` — Module entry point (GameModule export)
- `packages/frontend/src/game/modules/mtg/types.ts` — MTGCard, MTGState, zone types, phase types
- `packages/frontend/src/game/modules/mtg/zones.ts` — Zone definitions with crypto features
- `packages/frontend/src/game/modules/mtg/game.ts` — boardgame.io Game definition, moves, phases
- `packages/frontend/src/game/modules/mtg/mana.ts` — Mana parsing, color identity, costs
- `packages/frontend/src/game/modules/mtg/combat.ts` — Combat declaration, damage resolution
- `packages/frontend/src/game/modules/mtg/crypto-ops.ts` — Scry, tutor, mill, draw crypto protocols
- `packages/frontend/src/game/modules/mtg/visibility.ts` — MTG card visibility state machine (follows One Piece pattern)
- `packages/frontend/src/game/modules/mtg/game.test.ts` — Game flow + combat tests
- `packages/frontend/src/game/modules/mtg/crypto-ops.test.ts` — Crypto operations tests
- `packages/frontend/src/game/modules/mtg/mana.test.ts` — Mana system tests

**Modified Files:**
- `packages/frontend/src/crypto/mental-poker/types.ts` — Add `ReencryptionRequest`, `ReencryptionPhase` types
- `packages/frontend/src/game/modules/types.ts` — Add MTG to game module registry (if applicable)

## Inventory Check

Before starting, verify:
- [ ] `packages/frontend/src/crypto/mental-poker/sra.ts` exists and exports `encryptDeck`, `reencryptDeck`, `decryptCard`
- [ ] `packages/frontend/src/crypto/mental-poker/commitment.ts` exists for SHA256 commitment utilities
- [ ] `packages/frontend/src/game/plugins/deck.ts` exports `DeckPlugin`, `DeckPluginApi`, `moveCard`, `moveTop`
- [ ] `packages/frontend/src/game/modules/types.ts` exports `GameModule`, `CoreCard`, `ZoneDefinition`
- [ ] `packages/frontend/src/game/modules/onepiece/peek.ts` exists as reference for peek protocol pattern
- [ ] `packages/frontend/src/game/modules/onepiece/visibility.ts` exists as reference for visibility state machine
- [ ] `packages/frontend/src/game/modules/gofish/crypto.ts` exists as reference for multi-player setup + shuffle protocol
- [ ] All existing tests pass (`yarn test`)

## Completion Criteria

- [ ] All acceptance criteria in US-024.1 through US-024.6 met
- [ ] Re-encryption protocol works for 2, 3, and 4 players
- [ ] Scry correctly preserves owner-known cards until reshuffle
- [ ] Tutor + reshuffle removes all owner-known visibility from library
- [ ] Mill respects zone-based visibility (graveyard=public, exile face-down=owner-known)
- [ ] All tests pass (existing + new)
- [ ] Build succeeds (`yarn build`)
- [ ] No regressions in existing game modules

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
