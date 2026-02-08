# Task MM-039: One Piece TCG Deck Builder

**Repo:** ManaMesh
**Status:** Blocked
**Created:** 2026-02-07
**Dependencies:** MM-037, MM-038
**Worktree:** `feature/onepiece-deck-builder`

---

## Description

Build a full-featured deck builder for the One Piece TCG that lets players browse cards from asset packs, construct decks with validation, and persist/share deck lists. The deck builder is a standalone page for collection management with a quick-select integration at game start. It also extends the AssetPackLoader with a local file/directory upload source so users can load scraper output directly from their filesystem.

## Dependencies

- **MM-037** (Complete) — One Piece Card Scraper & Asset Pack Builder (produces the card data)
- **MM-038** (In Progress) — Card Rendering Engine / Phaser 3 (provides card image rendering, shares card types)

## User Stories

### US-MM-039.1: Local Asset Pack Upload

As a player, I want to load card data from a local directory or zip archive so that I can use scraper output without IPFS.

**Acceptance Criteria:**
- [ ] New `LocalSource` type added to `AssetPackSource` union: `{ type: 'local', packId: string }`
- [ ] UI allows selecting a local directory via `<input type="file" webkitdirectory>` or a zip file via `<input type="file" accept=".zip">`
- [ ] Selected directory is zipped client-side using `fflate` (reusing existing zip utilities)
- [ ] Zip is extracted, manifest parsed, and all card images cached into IndexedDB via existing cache layer
- [ ] Once loaded, the pack appears in the stored packs list alongside IPFS/HTTP packs
- [ ] Works with the scraper's output format (nested set manifests: root manifest.json → set directories → per-set manifest.json)

### US-MM-039.2: Card Browser

As a deck builder, I want to browse all cards from a loaded asset pack so that I can explore what's available.

**Acceptance Criteria:**
- [ ] Card grid displays card images with name, cost, power, and color indicators
- [ ] Cards load lazily from IndexedDB cache (using existing `useCardImage` hook)
- [ ] Grid supports pagination or virtual scrolling for 1000+ cards
- [ ] Card click opens a preview modal/panel with full card details (all metadata fields)
- [ ] Visual card size is adjustable (small/medium/large grid)

### US-MM-039.3: Search & Filter

As a deck builder, I want to search and filter cards so that I can find specific cards quickly.

**Acceptance Criteria:**
- [ ] Text search across card name and effect text
- [ ] Filter by color (red, green, blue, purple, black, yellow — multi-select)
- [ ] Filter by card type (leader, character, event, stage)
- [ ] Filter by cost range (0–10+)
- [ ] Filter by power range
- [ ] Filter by set
- [ ] Filter by rarity (C, UC, R, SR, SEC, L, SP)
- [ ] Sort by: name, cost, power, color, set number
- [ ] Active filters shown as removable chips/tags
- [ ] Filter state persisted in URL query params (shareable links)

### US-MM-039.4: Deck Construction

As a deck builder, I want to add and remove cards to build a valid deck list.

**Acceptance Criteria:**
- [ ] Split-panel layout: card browser on left, deck list on right
- [ ] Click card in browser to add to deck (or drag-and-drop)
- [ ] Click card in deck list to remove (with quantity decrement)
- [ ] Deck list shows card quantities (e.g., "Perona ×4")
- [ ] Deck list grouped by card type (Leader / Characters / Events / Stages)
- [ ] Running total of cards shown (e.g., "48/50")
- [ ] Leader card shown prominently at top of deck list
- [ ] Undo/redo support for add/remove operations

### US-MM-039.5: Deck Validation (Tournament Rules)

As a competitive player, I want my deck validated against tournament rules so that I know it's legal.

**Acceptance Criteria:**
- [ ] Exactly 1 leader card required
- [ ] Exactly 50 non-leader cards in main deck
- [ ] Maximum 4 copies of any card (by card number, e.g., OP01-077)
- [ ] All non-leader cards must match at least one of the leader's color(s)
- [ ] DON!! deck (10 cards) auto-added based on leader — not user-selected
- [ ] Validation errors shown inline with specific card highlights
- [ ] Validation summary bar: green (valid), yellow (incomplete), red (errors)
- [ ] Cannot start game with invalid deck

### US-MM-039.6: Deck Statistics

As a deck builder, I want to see deck statistics so that I can evaluate my deck composition.

**Acceptance Criteria:**
- [ ] Cost curve histogram (how many cards at each cost 0–10+)
- [ ] Color distribution pie/bar chart
- [ ] Card type breakdown (characters vs events vs stages)
- [ ] Average cost calculation
- [ ] Counter value distribution (cards with/without counter, average counter)
- [ ] Power distribution for characters
- [ ] Stats update in real-time as cards are added/removed

### US-MM-039.7: Deck Persistence & Import/Export

As a player, I want to save, load, and share my deck lists.

**Acceptance Criteria:**
- [ ] Decks saved to IndexedDB with name, timestamp, and associated pack ID
- [ ] Deck list view showing all saved decks with name, leader, card count, last modified
- [ ] Duplicate and delete deck operations
- [ ] Export deck as YAML file with format:
  ```yaml
  name: "Red Luffy Aggro"
  game: onepiece
  leader: OP01-001
  cards:
    OP01-004: 4
    OP01-006: 4
    OP01-008: 3
    # ... (50 cards total)
  ```
- [ ] Import deck from YAML file
- [ ] Export deck as TOML file (same data, TOML syntax)
- [ ] Import deck from TOML file
- [ ] IPFS publish: serialize deck list to YAML, pin to IPFS, return CID for sharing
- [ ] Import from IPFS CID (fetches YAML, parses, validates)

### US-MM-039.8: Game Start Integration

As a player, I want to select a deck when starting a One Piece TCG game.

**Acceptance Criteria:**
- [ ] Pre-game deck selection screen shown before game board loads
- [ ] Dropdown/list of saved decks with leader preview and validation status
- [ ] "Quick build" button opens the full deck builder
- [ ] Selected deck is validated before allowing game start
- [ ] Deck cards are converted from manifest `CardManifestEntry` to `OnePieceCard[]` for `loadDeck` move
- [ ] Card images are preloaded from the asset pack for the selected deck

## Technical Details

### Architecture

```
src/
├── assets/
│   └── loader/
│       ├── types.ts          # Add LocalSource to AssetPackSource
│       ├── local-loader.ts   # NEW: Local directory/zip upload handler
│       └── loader.ts         # Wire up local source handling
│
├── deck/                     # NEW: Deck builder module
│   ├── types.ts              # DeckList, DeckValidation, DeckStats interfaces
│   ├── storage.ts            # IndexedDB persistence for deck lists
│   ├── validation.ts         # Tournament rule validation engine
│   ├── stats.ts              # Deck statistics calculator
│   ├── serialization.ts      # YAML/TOML import/export
│   └── index.ts              # Public API exports
│
├── components/
│   ├── DeckBuilder/          # NEW: Deck builder UI
│   │   ├── DeckBuilderPage.tsx       # Main page layout (browser + deck list)
│   │   ├── CardBrowser.tsx           # Card grid with search/filter
│   │   ├── CardFilters.tsx           # Filter controls
│   │   ├── CardPreview.tsx           # Full card detail modal
│   │   ├── DeckList.tsx              # Current deck list panel
│   │   ├── DeckStats.tsx             # Statistics panel
│   │   ├── DeckValidation.tsx        # Validation status bar
│   │   ├── DeckManager.tsx           # Saved decks list
│   │   ├── ImportExportPanel.tsx     # YAML/TOML/IPFS import/export
│   │   └── AssetPackUpload.tsx       # Local file/directory upload UI
│   │
│   └── OnePiecePhaserBoard.tsx       # Modified: add pre-game deck selection
│
├── hooks/
│   ├── useDeckBuilder.ts     # NEW: Deck builder state management
│   ├── useDeckStorage.ts     # NEW: IndexedDB deck CRUD
│   └── useDeckValidation.ts  # NEW: Real-time validation hook
│
└── App.tsx                   # Add /deck-builder route
```

### Key Interfaces

```typescript
// Deck list stored in IndexedDB
interface DeckList {
  id: string;           // UUID
  name: string;
  game: 'onepiece';
  packId: string;       // Associated asset pack
  leaderId: string;     // Card ID of leader
  cards: Record<string, number>;  // cardId → quantity
  createdAt: number;
  updatedAt: number;
}

// Validation result
interface DeckValidationResult {
  isValid: boolean;
  errors: DeckValidationError[];
  warnings: DeckValidationWarning[];
}

interface DeckValidationError {
  type: 'no-leader' | 'wrong-deck-size' | 'over-copy-limit' | 'color-mismatch';
  message: string;
  cardIds?: string[];
}

// Deck statistics
interface DeckStats {
  totalCards: number;
  costCurve: Record<number, number>;    // cost → count
  colorDistribution: Record<string, number>;
  typeBreakdown: Record<string, number>;
  avgCost: number;
  counterDistribution: { withCounter: number; withoutCounter: number; avgCounter: number };
  powerDistribution: Record<number, number>;
}
```

### YAML Deck Format

```yaml
# ManaMesh One Piece TCG Deck List
name: "Red Luffy Aggro"
game: onepiece
pack: "ipfs:QmXxx..."   # or "local:onepiece-complete"
leader: OP01-001
cards:
  OP01-004: 4
  OP01-006: 4
  OP01-008: 3
  OP01-010: 4
  OP01-013: 2
  OP01-015: 4
  OP01-017: 4
  OP01-019: 3
  OP01-021: 4
  OP01-025: 4
  OP01-029: 3
  OP01-031: 4
  OP01-033: 4
  OP01-035: 3
```

### Card Resolution: Manifest → OnePieceCard

The deck builder stores card IDs (from manifests). At game start, these are resolved to full `OnePieceCard` objects:

```typescript
function resolveManifestCard(entry: CardManifestEntry): OnePieceCard {
  return {
    id: entry.id,
    name: entry.name,
    imageCid: '', // resolved at runtime from pack
    cardType: entry.metadata?.cardType as OnePieceCardType,
    cost: entry.metadata?.cost as number | undefined,
    power: entry.metadata?.power as number | undefined,
    counter: entry.metadata?.counter as number | undefined,
    color: (entry.metadata?.colors as string[])?.map(c => c.toLowerCase()) ?? [],
    attributes: entry.metadata?.traits as string[] | undefined,
    effectText: entry.metadata?.text as string | undefined,
    set: entry.id.split('-')[0],  // "OP01" from "OP01-077"
    cardNumber: entry.id,
    rarity: entry.metadata?.rarity as OnePieceRarity ?? 'C',
    life: entry.metadata?.life as number | undefined,
  };
}
```

## Files to Create/Modify

**New Files:**
- `src/assets/loader/local-loader.ts` — Local directory/zip upload handler
- `src/deck/types.ts` — DeckList, validation, stats interfaces
- `src/deck/storage.ts` — IndexedDB deck persistence
- `src/deck/validation.ts` — Tournament rule validation
- `src/deck/stats.ts` — Deck statistics calculator
- `src/deck/serialization.ts` — YAML/TOML import/export + IPFS publish
- `src/deck/index.ts` — Public API
- `src/components/DeckBuilder/DeckBuilderPage.tsx` — Main page
- `src/components/DeckBuilder/CardBrowser.tsx` — Card grid
- `src/components/DeckBuilder/CardFilters.tsx` — Filter controls
- `src/components/DeckBuilder/CardPreview.tsx` — Card detail modal
- `src/components/DeckBuilder/DeckList.tsx` — Deck list panel
- `src/components/DeckBuilder/DeckStats.tsx` — Statistics
- `src/components/DeckBuilder/DeckValidation.tsx` — Validation bar
- `src/components/DeckBuilder/DeckManager.tsx` — Saved decks list
- `src/components/DeckBuilder/ImportExportPanel.tsx` — Import/export UI
- `src/components/DeckBuilder/AssetPackUpload.tsx` — Local upload UI
- `src/hooks/useDeckBuilder.ts` — State management hook
- `src/hooks/useDeckStorage.ts` — IndexedDB CRUD hook
- `src/hooks/useDeckValidation.ts` — Real-time validation hook

**Modified Files:**
- `src/assets/loader/types.ts` — Add `LocalSource` to `AssetPackSource` union
- `src/assets/loader/loader.ts` — Wire up local source handling
- `src/components/OnePiecePhaserBoard.tsx` — Add pre-game deck selection
- `src/App.tsx` — Add `/deck-builder` route

**Tests:**
- `src/deck/validation.test.ts` — Tournament rule tests
- `src/deck/stats.test.ts` — Statistics calculation tests
- `src/deck/serialization.test.ts` — YAML/TOML round-trip tests
- `src/deck/storage.test.ts` — IndexedDB CRUD tests
- `src/assets/loader/local-loader.test.ts` — Local upload tests

**Dependencies to Add:**
- `js-yaml` — YAML parsing/serialization
- `@iarna/toml` (or `smol-toml`) — TOML parsing/serialization

## Inventory Check

Before starting, verify:
- [ ] Asset pack loader code exists at `src/assets/loader/`
- [ ] `useCardImage` hook exists at `src/hooks/useCardImage.ts`
- [ ] `OnePieceCard` and `OnePiecePlayerState` types exist at `src/game/modules/onepiece/types.ts`
- [ ] `CardManifestEntry` type exists at `src/assets/manifest/types.ts`
- [ ] `fflate` is available (used by existing zip-extractor.ts)
- [ ] `idb-keyval` is available (used by existing cache.ts)
- [ ] IPFS loader exists at `src/assets/ipfs-loader.ts`

## Completion Criteria

- [ ] All acceptance criteria met across 8 user stories
- [ ] Tests pass (validation, stats, serialization, storage, local-loader)
- [ ] Vite build succeeds
- [ ] Can upload a local scraper output directory and browse cards
- [ ] Can build a valid 51-card deck (1 leader + 50 cards)
- [ ] Can export/import deck as YAML and TOML
- [ ] Can select deck and start a game with it
- [ ] Color matching validation works correctly for multi-color leaders

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
