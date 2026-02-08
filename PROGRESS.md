# ManaMesh Development Progress

Last updated: 2026-02-08

## MM-039: One Piece TCG Deck Builder

**Status:** In Progress — Core implementation complete, iterating on UX and asset pack persistence.

### What Was Built

#### Core Deck Module (`packages/frontend/src/deck/`)
- **types.ts** — `DeckList`, `EnrichedCard`, validation/stats types, `enrichCard()` utility
- **validation.ts** — `validateDeck()`, `canAddCard()` enforcing One Piece TCG tournament rules (50-card main, 10-card DON, 1 leader, max 4 copies)
- **stats.ts** — `calculateDeckStats()` for cost curve, color distribution, type breakdown, counter values
- **serialization.ts** — YAML/TOML import/export with `downloadFile()` and `readFileAsText()`
- **storage.ts** — IndexedDB persistence for saved decks via `idb-keyval`
- **index.ts** — Public API barrel exports

#### Asset Loader Extensions (`packages/frontend/src/assets/loader/`)
- **local-loader.ts** (NEW) — `loadLocalZip()`, `loadLocalDirectory()`, `reloadLocalPack()` with fflate zip creation and extraction
- **types.ts** — Added `LocalSource` to `AssetPackSource` union; added `cards?` and `manifest?` fields to `StoredPackMetadata` for fast reload
- **loader.ts** — Added local source dispatch in `loadPack()` with dual-cache lookup (loader + local-loader maps) and IndexedDB reconstruction
- **cache.ts** — Three-store IndexedDB architecture (see Architecture Decisions below)
- **index.ts** — Exports for `reloadLocalPack`, zip extractor utilities

#### React Hooks (`packages/frontend/src/hooks/`)
- **useDeckBuilder.ts** — Deck state management with undo/redo history
- **useDeckStorage.ts** — IndexedDB CRUD wrapper for saved decks
- **useDeckValidation.ts** — Reactive validation with error/warning status

#### UI Components (`packages/frontend/src/components/DeckBuilder/`)
- **DeckBuilderPage.tsx** — Main orchestration: multi-pack support, tab-based right panel (Packs/Deck/Stats/I-O/Saved)
- **CardBrowser.tsx** — Card grid with size options (S/M/L), hover preview pane showing larger card + metadata, `cardPackMap` for multi-pack image routing
- **CardFilters.tsx** — Filter controls (color, type, cost, search text)
- **CardPreview.tsx** — Card detail display (accepts nullable packId)
- **CardTile.tsx** — Individual card tile with `aspectRatio: '5/7'` and `objectFit: 'contain'`
- **DeckListPanel.tsx** — Deck list grouped by type, uses `cardPackMap` for image resolution
- **DeckStats.tsx** — Statistics panel with cost curve and color/type breakdowns
- **DeckValidation.tsx** — Validation status bar with error/warning counts
- **DeckManager.tsx** — Saved decks list with load/duplicate/delete
- **ImportExportPanel.tsx** — YAML/TOML import/export controls
- **AssetPackUpload.tsx** — Upload zip or select directory with progress bar

#### Integration
- **App.tsx** — Added `deck-builder` game mode routing
- **GameSelector.tsx** — Added "Deck Builder" button

#### Bracket-Text Styling (`packages/frontend/src/deck/bracket-styles.ts`)
- **bracket-styles.ts** — Configurable regex pattern→hex color system for highlighting `[Keyword]` text in card effects. localStorage persistence following `assets/config.ts` pattern. Compiled regex cache for performance.
- **StyledEffectText.tsx** — React component that parses effect text and renders bracket keywords as colored `<span>` elements with `useMemo` caching.
- 15 default One Piece TCG keyword patterns: On Play, When Attacking, Trigger, DON.* (regex), Blocker, Rush, Counter, Activate:\s*Main, Main, etc.
- Integrated into both `HoverPreviewPane` (CardBrowser.tsx) and detail modal (CardPreview.tsx)

#### Hover Preview Enhancements
- Preview pane width doubled to 400px (2× Large grid size) for better card visibility
- All preview text font sizes doubled for readability
- Card name: 28px, tags: 20px, info lines: 22px, effect text: 22px

#### Tests (68 tests across 6 files)
- `deck/types.test.ts` — 7 tests (enrichCard)
- `deck/validation.test.ts` — 14 tests (validateDeck, canAddCard)
- `deck/stats.test.ts` — 10 tests (calculateDeckStats)
- `deck/serialization.test.ts` — 13 tests (YAML/TOML round-trip, validation)
- `deck/storage.test.ts` — 8 tests (IndexedDB CRUD with mocked idb-keyval)
- `deck/bracket-styles.test.ts` — 16 tests (parser, regex matching, fallback colors, custom configs, case insensitivity)

### Architecture Decisions

#### Three-Store IndexedDB Architecture
Each data type gets its own IndexedDB database to prevent namespace collisions:

| Store | Database Name | Key | Value |
|---|---|---|---|
| Pack metadata | `manamesh-asset-packs` | `packId` | `StoredPackMetadata` |
| Card images | `manamesh-card-images` | `pack:{id}:card:{id}:{side}` | `Blob` |
| Zip archives | `manamesh-pack-zips` | `packId` | `Blob` |

**Why:** An earlier design stored zip blobs in the metadata store with a `zip:` key prefix. `getAllPackMetadata()` then returned zip Blobs alongside metadata objects, causing phantom entries in the UI. Separate stores eliminate this class of bug entirely.

#### Two-Tier Pack Reload (Fast Path / Slow Path)
- **Fast path:** `StoredPackMetadata` now includes optional `cards` and `manifest` fields. On reload, read metadata from IndexedDB — single key-value lookup, no decompression needed.
- **Slow path (fallback):** For packs stored before the `cards` field was added, extract from the stored zip blob, parse manifest, resolve nested sets. After extraction, backfill the metadata with `cards`/`manifest` so subsequent reloads use the fast path.

#### Multi-Pack Card Image Routing
Instead of a single `packId: string` prop, components receive `cardPackMap: Map<string, string>` (cardId -> packId). This allows cards from multiple loaded packs to coexist in the browser, with each card's images routed to the correct pack's cache.

#### Local Directory Upload Flow
1. User selects directory via `<input webkitdirectory>`
2. All files read into `Map<string, Uint8Array>`
3. Zipped client-side with `fflate`
4. Zip blob stored in `manamesh-pack-zips` IndexedDB store
5. Extracted, manifest parsed, nested set manifests resolved
6. Card images cached individually in `manamesh-card-images`
7. Pack metadata (including full card entries) stored in `manamesh-asset-packs`
8. On next visit, pack appears in "Available Packs" — reload reads metadata directly (fast path) or re-extracts from zip (slow path)

### Bugs Fixed

#### Phantom "cards |" Entries in Available Packs
- **Cause:** Zip blobs stored in the same IndexedDB store as pack metadata with a `zip:` key prefix. `getAllPackMetadata()` returned both, and zip Blobs rendered as empty metadata entries.
- **Fix:** Moved zip blobs to dedicated `manamesh-pack-zips` store. `getAllPackMetadata()` now scans a clean store.

#### "Load" Button Does Nothing for Stored Packs
- **Cause:** Dual in-memory cache. `loader.ts` and `local-loader.ts` each maintain separate `Map<string, LoadedAssetPack>` instances that don't know about each other. `loadPack()` for local sources only checked `loader.ts`'s map.
- **Fix:** `loadPack()` now checks local-loader's cache via `getLocalPack()`, then attempts IndexedDB reconstruction via `reloadLocalPack()`.

#### Cards Cropped in Grid View
- **Cause:** `objectFit: 'cover'` with fixed pixel heights on `<img>` elements crops card art to fill the tile.
- **Fix:** Changed to `objectFit: 'contain'` with `aspectRatio: '5/7'` (standard card proportions ~63x88mm) on tile containers, `width: 100%; height: 100%` on images.

#### Cards Overlapping in Grid
- **Cause:** CSS Grid as a direct flex child with `flex: 1` distributes its constrained height across all rows instead of allowing overflow. Cards get squished into tiny slices.
- **Fix:** Separated scroll container from grid container — outer div gets flex sizing (`flex: 1, minHeight: 0, overflowY: auto`), inner div is the unconstrained grid that overflows naturally.

#### Shuffle Phase Deadlock in Go Fish (2026-02-05)
- **Cause:** The commit-reveal seed steps in Go Fish's shuffle phase were gated behind `isMySetupTurn` in GoFishBoard.tsx. Only the sequential `shuffleDeck` call should be gated — commit/reveal must be open to all players simultaneously.
- **Fix:** Removed `isMySetupTurn` gate from commit/reveal steps; added `G.shuffleRng` to useEffect dependency array.

### Dependencies Added
- `js-yaml` + `@types/js-yaml` — YAML serialization for deck import/export
- `smol-toml` — TOML serialization for deck import/export
- `fflate` — Already present; now also used for zip creation (directory -> zip) in addition to extraction

### Build & Test Status
- **Vite build:** PASS (8.8MB single-file output)
- **Tests:** 1052 passed, 3 skipped (58 test files)
- **Type-check:** Pre-existing errors in third-party packages only; project code is clean

### Known Issues / Next Steps
- Users upgrading from before the three-store refactor need to clear IndexedDB manually (or use "Clear All Stored Packs" button) to remove stale data from the old schema
- IPFS/HTTP asset pack loading is stubbed but not yet tested end-to-end
- Card preview hover pane could show card back on hover-over-flip interaction
- No "delete single stored pack" button yet (only "Clear All")
- Deck builder now integrates with the game lobby via the ready phase (MM-040)

## MM-040: P2P Asset Pack Sharing & IPFS Hash Import

**Status:** In Progress — All 8 user stories implemented. Lobby ready phase complete. Pending manual E2E testing.

### What Was Built

#### P2P Chunking Protocol (`packages/frontend/src/p2p/chunking.ts`)
- `chunkBlob()` — splits Blob into base64-encoded chunks (48KB raw → ~64KB base64)
- `createChunkCollector()` — stateful reassembly with progress callbacks, out-of-order & duplicate handling
- `arrayBufferToBase64()` / `base64ToArrayBuffer()` — browser-native conversion utilities
- 12 tests covering round-trips, multi-chunk splits, progress, edge cases

#### P2P Asset Sharing Protocol (`packages/frontend/src/p2p/asset-sharing.ts`)
- 8 message types: `deck-list-share`, `deck-list-ack`, `asset-pack-request`, `asset-pack-offer`, `asset-pack-chunk`, `asset-pack-complete`, `asset-pack-denied`, `asset-pack-cancel`
- `PeerBlockList` — per-player session-scoped blocking with auto-block after N requests
- `AssetSharingSession` — transfer state tracking + static message factory methods
- `findMissingCards()`, `isAssetSharingMessage()` utilities
- 25 tests covering block list, auto-blocking, transfer tracking, message factories

#### Lobby Protocol (`packages/frontend/src/p2p/lobby-protocol.ts`)
- JSON envelope `{ _lobby: true, payload }` over raw `JoinCodeConnection.send(string)`
- Supports both `AssetSharingMessage` (deck list, asset transfer) and `LobbyControlMessage` (ready state)
- `handleRawMessage()` returns true if consumed, false for passthrough to other handlers
- 11 tests covering envelope format, routing, control messages, subscribe/unsubscribe

#### Transfer Pipeline (`packages/frontend/src/p2p/transfer-pipeline.ts`)
- `buildCardsOnlyBlob()` — reads card images from IndexedDB, packages with length-prefixed JSON header
- `buildFullPackBlob()` — reads zip archive from IndexedDB
- `sendCardsTransfer()` / `sendFullPackTransfer()` — build blob → chunk → send offer + chunks + complete
- `unpackCardsOnlyBlob()` — parse header, extract images, store in IndexedDB with pack metadata
- `unpackFullPackBlob()` — store zip blob for later loading
- Binary format: `[4-byte uint32 BE header length][JSON header][concatenated image blobs]`
- 8 tests covering build, round-trip, progress callbacks, metadata preservation

#### Transport Extensions (`packages/frontend/src/p2p/transport.ts`)
- Extended `P2PMessageType` union with 8 asset sharing types
- `onAssetSharingMessage(cb)`, `sendAssetSharingMessage(msg)`, `handleAssetSharingMessage()`

#### Asset Loader Extensions
- `types.ts` — `P2PSource` interface, extended `AssetPackSource` union
- `loader.ts` — P2P source handler (reconstructs from IndexedDB metadata)

#### UI Components (`packages/frontend/src/components/AssetPackSharing/`)
- `ConsentDialog.tsx` — `SenderConsentDialog`, `ReceiverConsentDialog`, `MissingPacksNotice`
- `TransferProgress.tsx` — Progress bar with chunk counts, cancel button, status colors
- `BlockList.tsx` — Blocked peers list with unblock buttons

#### React Hook (`packages/frontend/src/hooks/useAssetSharing.ts`)
- Bridges transport layer → protocol state machine → React state
- Real transfer pipeline: `allowSenderRequest` builds blob, chunks, and sends
- Incoming chunks reassembled via `createChunkCollector`, unpacked via `unpackCardsOnlyBlob`/`unpackFullPackBlob`

#### Lobby Ready Phase (`packages/frontend/src/components/P2PLobby.tsx`)
- Connection no longer immediately starts game — enters deck selection phase
- `ReadyPhaseUI` component: deck selector, deck list sharing, ready coordination
- Saved decks listed via `useDeckStorage()` hook
- Deck list shared with peer on selection via `AssetSharingSession.createDeckListShare()`
- `lobby-ready` control message sent on Ready/Cancel Ready toggle
- Game starts only when both players are ready (800ms UI delay for feedback)
- Integrated asset sharing overlays (missing packs, transfer progress, consent dialogs, block list)

#### IPFS Hash Import/Export
- `AssetPackUpload.tsx` — IPFS CID input with CIDv0/CIDv1 validation
- `DeckBuilderPage.tsx` — CID display + copy for `ipfs:`/`ipfs-zip:` loaded packs

#### Asset Pack Management (`packages/frontend/src/components/AssetPackManagement.tsx`)
- Standalone page accessible from GameSelector ("Asset Packs" button)
- IPFS CID import field with validation and progress
- Stored packs list with card count, source info, IPFS CID display
- Per-pack delete with confirmation dialog
- `App.tsx` route: `"asset-packs"` game mode
- `GameSelector.tsx` — "Asset Packs" button (purple) next to "Deck Builder"

### Build & Test Status
- **Build:** Clean (Vite, 8.8MB)
- **Tests:** 1052 passed, 3 skipped (58 files)

### Remaining Work
1. End-to-end manual testing with two peers
