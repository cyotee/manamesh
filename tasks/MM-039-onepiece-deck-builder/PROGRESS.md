# Progress Log: MM-039

## Current Checkpoint

**Last checkpoint:** Hover preview enlargement + bracket-text styling system
**Next step:** Test bracket styling with real card data; consider settings UI for color customization
**Build status:** PASS (Vite build succeeds, 8.8MB)
**Test status:** PASS (996 tests, 54 files)

---

## Session Log

### 2026-02-08 (Session 4) — Hover Preview + Bracket-Text Styling

**Hover preview pane enlarged:**
- Width doubled from 250px to 400px (2× the Large grid size)
- All text font sizes doubled: card name 28px, tags 20px, info lines 22px, effect text 22px
- Placeholder heights adjusted to 560px (maintaining 5:7 card aspect ratio)

**Configurable bracket-text styling system:**
- New `bracket-styles.ts` module with regex pattern→hex color mapping
- `BracketStyleConfig = Record<string, string>` (JSON-serializable for localStorage)
- Parser: `parseEffectText()` splits text on `[...]` brackets, matches inner content against compiled regex patterns (first match wins)
- Compiled regex cache — only recompiles when config reference changes
- localStorage persistence following `assets/config.ts` pattern: `getBracketStyles()`, `setBracketStyles()`, `resetBracketStyles()`
- Invalid regex patterns caught with try/catch + console.warn

**Default keyword colors (15 patterns):**
- Blue (#0d47a1): On Play, When Attacking, Main, Activate:\s*Main, Your Turn
- Yellow (#fdd835): Trigger
- Red (#c62828): Counter
- Dark red (#b71c1c): Rush, Opponent's Turn
- Orange (#ff9800): Blocker
- Black (#000000): DON.* (regex matching all DON variants)
- Purple (#6a1b9a): On K.O., Activate.*
- Blue (#1565c0): On Block
- Brown (#4e342e): End of Turn
- Blue-grey (#37474f): Once Per Turn
- Fallback (#5a4a7a): Unmatched brackets

**StyledEffectText React component:**
- `useMemo` on `parseEffectText` for render efficiency
- Bracket spans: white text, colored background, bold, no-wrap, rounded corners
- Accepts optional config/fallbackColor overrides
- Integrated into HoverPreviewPane (CardBrowser.tsx) and detail modal (CardPreview.tsx)

**Tests:** 16 new tests in `bracket-styles.test.ts` covering parser, regex matching, fallbacks, custom configs, case insensitivity

**Files created:**
- `src/deck/bracket-styles.ts` — Config types, defaults, persistence, parser
- `src/deck/bracket-styles.test.ts` — 16 tests
- `src/components/DeckBuilder/StyledEffectText.tsx` — React component

**Files modified:**
- `src/components/DeckBuilder/CardBrowser.tsx` — Enlarged preview pane, StyledEffectText integration
- `src/components/DeckBuilder/CardPreview.tsx` — StyledEffectText integration
- `src/deck/index.ts` — Re-exports for bracket-styles public API

### 2026-02-07 (Session 3) — UX Polish + IndexedDB Architecture Fix

**Multi-pack refactor completed:**
- Updated `CardBrowser`, `CardPreview`, `DeckListPanel` to accept `cardPackMap: Map<string, string>` instead of `packId: string`
- `useCardImage` hook accepts nullable `packId` for graceful handling

**"Load" button fix:**
- Root cause: `loader.ts` and `local-loader.ts` each had separate `Map<string, LoadedAssetPack>` caches that didn't know about each other
- Fix: `loadPack()` now checks local-loader's cache via `getLocalPack()`, then attempts IndexedDB reconstruction via `reloadLocalPack()`

**Card display fixes:**
- Changed `objectFit: 'cover'` → `objectFit: 'contain'` to show full card faces
- Removed fixed pixel heights from `GRID_SIZES`, added `aspectRatio: '5/7'` on tile containers
- Fixed CSS Grid overlap: separated scroll container from grid container (outer div gets `flex: 1, minHeight: 0, overflowY: auto`, inner div is unconstrained grid)

**Hover preview pane:**
- Added `HoverPreviewPane` component to `CardBrowser`
- Shows larger card image + metadata (name, type, colors, rarity, cost, power, effect text) on hover

**Zip blob persistence (local asset pack flow):**
- `loadLocalDirectory()` now zips files with fflate before processing
- `loadLocalZip()` stores the zip blob in IndexedDB
- `processExtractedEntries()` stores zip blob + full metadata including card entries
- `reloadLocalPack()` has fast path (read cards from metadata) and slow path (re-extract zip, backfill metadata)

**Fast reload via stored card data:**
- Added optional `cards?` and `manifest?` fields to `StoredPackMetadata`
- `reloadLocalPack()` reads these directly from IndexedDB when available — no zip extraction needed
- Slow path (zip extraction) auto-backfills metadata for future fast reloads

**Three-store IndexedDB refactor (critical bug fix):**
- Bug: zip blobs were stored in the metadata store with `zip:` key prefix. `getAllPackMetadata()` returned them as phantom entries ("cards |" with empty name/game)
- Fix: Created dedicated `manamesh-pack-zips` store. Three stores now:
  - `manamesh-asset-packs` → `StoredPackMetadata` objects only
  - `manamesh-card-images` → card image `Blob`s
  - `manamesh-pack-zips` → zip archive `Blob`s
- `clearPackCache()` now cleans up all three stores for a given pack

**Available Packs UX:**
- Loaded packs no longer appear in "Available Packs" section (filtered out to avoid confusion)
- Added "Clear All Stored Packs" button to Packs tab
- Removed local pack filter from `getStoredPacks()` — local packs show in Available Packs since they're now properly persisted

**Files changed this session:**
- `src/assets/loader/cache.ts` — Three-store architecture, `storePackZip`/`getPackZip`/`deletePackZip`
- `src/assets/loader/local-loader.ts` — Zip blob persistence, fast/slow reload paths, fflate zip creation
- `src/assets/loader/loader.ts` — Dual-cache lookup for local sources
- `src/assets/loader/types.ts` — `cards?` and `manifest?` on `StoredPackMetadata`
- `src/assets/loader/index.ts` — Export `reloadLocalPack`
- `src/components/DeckBuilder/DeckBuilderPage.tsx` — Multi-pack props, Available Packs filtering, Clear button
- `src/components/DeckBuilder/CardBrowser.tsx` — `cardPackMap`, hover preview, grid layout fixes
- `src/components/DeckBuilder/CardPreview.tsx` — Nullable `packId`
- `src/components/DeckBuilder/DeckListPanel.tsx` — `cardPackMap` instead of `packId`

### 2026-02-07 (Session 2) — Multi-pack + Card Display

- Completed `cardPackMap` refactor across all child components
- Fixed card cropping and overlap issues
- Added hover preview pane
- Started local asset pack persistence work

### 2026-02-07 (Session 1) — Implementation Complete

**Dependencies installed:** js-yaml, @types/js-yaml, smol-toml

**Core deck module (6 files):**
- `src/deck/types.ts` — DeckList, EnrichedCard, validation/stats types, enrichCard()
- `src/deck/validation.ts` — validateDeck(), canAddCard() (tournament rules)
- `src/deck/stats.ts` — calculateDeckStats() (cost curve, colors, types, counters)
- `src/deck/serialization.ts` — YAML/TOML import/export, downloadFile, readFileAsText
- `src/deck/storage.ts` — IndexedDB persistence via idb-keyval
- `src/deck/index.ts` — Public API barrel exports

**Asset loader extensions (3 files modified, 1 new):**
- `src/assets/loader/types.ts` — Added LocalSource to AssetPackSource union
- `src/assets/loader/loader.ts` — Added local source dispatch
- `src/assets/loader/index.ts` — Added LocalSource type + local-loader exports
- `src/assets/loader/local-loader.ts` — NEW: loadLocalZip(), loadLocalDirectory()

**React hooks (3 files):**
- `src/hooks/useDeckBuilder.ts` — Deck state management with undo/redo
- `src/hooks/useDeckStorage.ts` — IndexedDB CRUD wrapper
- `src/hooks/useDeckValidation.ts` — Reactive validation with status

**UI components (10 files):**
- `src/components/DeckBuilder/DeckBuilderPage.tsx` — Main page orchestration
- `src/components/DeckBuilder/CardBrowser.tsx` — Card grid with lazy loading
- `src/components/DeckBuilder/CardFilters.tsx` — Filter controls (color, type, cost, etc.)
- `src/components/DeckBuilder/CardPreview.tsx` — Card detail modal
- `src/components/DeckBuilder/DeckListPanel.tsx` — Deck list panel (grouped by type)
- `src/components/DeckBuilder/DeckStats.tsx` — Statistics panel (cost curve, colors, etc.)
- `src/components/DeckBuilder/DeckValidation.tsx` — Validation status bar
- `src/components/DeckBuilder/DeckManager.tsx` — Saved decks list
- `src/components/DeckBuilder/ImportExportPanel.tsx` — YAML/TOML import/export
- `src/components/DeckBuilder/AssetPackUpload.tsx` — Local file/directory upload

**Integration (2 files modified):**
- `src/App.tsx` — Added "deck-builder" game mode + DeckBuilderPage routing
- `src/components/GameSelector.tsx` — Added "Deck Builder" button

**Tests (5 files, 52 tests):**
- `src/deck/types.test.ts` — 7 tests (enrichCard)
- `src/deck/validation.test.ts` — 14 tests (validateDeck, canAddCard)
- `src/deck/stats.test.ts` — 10 tests (calculateDeckStats)
- `src/deck/serialization.test.ts` — 13 tests (YAML/TOML round-trip, validation)
- `src/deck/storage.test.ts` — 8 tests (IndexedDB CRUD with mocked idb-keyval)

### 2026-02-07 — Task Created

- Task designed via /design
- TASK.md populated with requirements
- 8 user stories covering: local asset upload, card browser, search/filter, deck construction, validation, stats, persistence/export, game integration
