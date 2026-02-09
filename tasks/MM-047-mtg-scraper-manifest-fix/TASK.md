# Task MM-047: MTG Card Scraper — Fix Manifest Generation & Adapter Reliability

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-08
**Dependencies:** MM-042
**Worktree:** `feature/mtg-scraper-manifest-fix`

---

## Description

The multi-game card scraper (`tools/card-scraper/`) successfully generates manifests for One Piece TCG but produces **no manifests for MTG**. The root cause is that the Scryfall adapters (scryfall-bulk, scryfall-api) fail silently during the card fetch phase, causing `all_cards` to be empty for MTG sets. The manifest generation filter (`sets_with_cards`) then excludes all sets, producing zero manifest files despite 661 MTG set directories existing with downloaded images.

This task audits and fixes the full MTG scraper pipeline: adapter reliability, error reporting, configurable set filtering, terminal progress UX, double-faced card handling, and MTG-specific manifest schema with full Scryfall metadata.

## Dependencies

- MM-042 (Complete, archived) — MTG Card Scraper & Multi-Game Tool Refactor

## User Stories

### US-MM-047.1: Fix Scryfall Adapter Card Fetching

As a developer, I want the Scryfall adapters to reliably fetch MTG card data so that manifests can be generated.

**Acceptance Criteria:**
- [ ] `scryfall_bulk.py` successfully downloads and parses Default Cards JSON (~501 MB)
- [ ] `scryfall_bulk.py` correctly filters cards by set code and returns populated card lists
- [ ] `scryfall_api.py` pagination properly follows `next_page` URLs without silently terminating
- [ ] Card parsing errors are aggregated and reported as a summary (not just individual warnings)
- [ ] If an adapter returns 0 cards for a set that should have cards, a clear warning is emitted
- [ ] Adapters fall back correctly: if scryfall-bulk fails, scryfall-api is tried

### US-MM-047.2: Improve Error Reporting & Silent Failure Prevention

As a developer, I want clear error reporting when the scraper encounters problems so I can diagnose issues.

**Acceptance Criteria:**
- [ ] Adapter exceptions are logged with full context (set ID, adapter name, error message, stack trace)
- [ ] After card fetch phase, a summary table is printed: sets attempted, sets with cards, sets with 0 cards
- [ ] After image download phase, a summary is printed: images downloaded, images skipped, images failed
- [ ] After manifest generation, a summary is printed: manifests written, sets skipped
- [ ] The scraper exit code is non-zero if any critical failures occurred (e.g., 0 sets with cards)

### US-MM-047.3: Configurable Set Type Filtering

As a user, I want to filter which MTG set types to scrape so I can avoid downloading joke sets, art series, and promos I don't need.

**Acceptance Criteria:**
- [ ] `config.yaml` supports a `categories` filter under `games.mtg.scrape`:
  ```yaml
  scrape:
    sets: all
    categories:
      - core
      - expansion
      - commander
      - masters
      - draft_innovation
  ```
- [ ] When `categories` is set, only sets matching those Scryfall `set_type` values are scraped
- [ ] When `categories` is omitted or empty, all sets are scraped (current behavior)
- [ ] A `--categories` CLI flag allows override from command line
- [ ] The set discovery phase logs how many sets matched the filter vs total discovered

### US-MM-047.4: Fix Terminal Progress Display (Scrolling Issue)

As a user, I want the download progress to stay visible in my terminal without scrolling past the bottom.

**Acceptance Criteria:**
- [ ] Default mode: compact single-line progress using Rich `Live` or `Progress` that overwrites in-place
  - Shows: current set name, card N/M, overall set N/M, elapsed time
  - Per-set completion logged as a single summary line
- [ ] `--verbose` flag: shows every individual card download (current behavior)
- [ ] Progress bar properly handles terminal resize
- [ ] After all downloads complete, a final summary table is shown (total cards, total bytes, failures)

### US-MM-047.5: Double-Faced Card (DFC) Manifest Support

As a deck builder user, I want double-faced MTG cards to include both faces in the manifest so I can view both sides.

**Acceptance Criteria:**
- [ ] Cards with layouts `transform`, `modal_dfc`, `reversible_card`, `art_series` get both faces
- [ ] Manifest entry has `front` path (face 1 image) and `back` path (face 2 image)
- [ ] Image filenames use suffix convention: `{collector_number}-front.jpg`, `{collector_number}-back.jpg`
- [ ] `metadata.faces` array contains per-face data (name, manaCost, types, power/toughness, oracleText)
- [ ] Single-faced cards have `front` only (no `back` field)
- [ ] The downloader correctly fetches both face image URLs from Scryfall `card_faces[].image_uris`

### US-MM-047.6: Full Scryfall Metadata in MTG Manifests

As a deck builder, I want MTG card manifests to contain full Scryfall gameplay metadata.

**Acceptance Criteria:**
- [ ] Each card entry's `metadata` object includes:
  - `manaCost` (string, e.g., `{2}{W}{U}`)
  - `cmc` (number)
  - `types` (array of strings)
  - `subtypes` (array of strings)
  - `supertypes` (array of strings)
  - `power` (string or null)
  - `toughness` (string or null)
  - `loyalty` (string or null)
  - `colors` (array of color codes)
  - `colorIdentity` (array of color codes)
  - `rarity` (string)
  - `oracleText` (string)
  - `keywords` (array of strings)
  - `layout` (string, e.g., `normal`, `transform`, `modal_dfc`)
  - `legalities` (object with format → legality mappings)
  - `set` (string, set code)
  - `collectorNumber` (string)
  - `faces` (array, for multi-face cards only)
- [ ] The `game` field in manifests is `"mtg"`
- [ ] Metadata fields that are null/empty on the Scryfall card are omitted (not set to null)

### US-MM-047.7: Basic Frontend Adapter for MTG Manifests

As a user, I want to load MTG asset packs in the Asset Pack Manager and Deck Builder.

**Acceptance Criteria:**
- [ ] MTG set manifests are loadable via the existing `loadLocalZip()` / `loadLocalDirectory()` flow
- [ ] The manifest parser (`packages/frontend/src/assets/manifest/`) accepts MTG manifests
- [ ] MTG-specific metadata fields are preserved in `CardManifestEntry.metadata`
- [ ] Card names, images, and basic metadata display correctly in the Asset Pack Manager
- [ ] No changes required to the One Piece manifest handling (backwards compatible)

### US-MM-047.8: Full Re-Scrape & Validation

As a developer, I want to run a complete MTG scrape that produces valid manifests for all configured sets.

**Acceptance Criteria:**
- [ ] Running `python -m card_scraper scrape --game mtg` completes without errors
- [ ] Root manifest exists at `output/mtg/manifest.json`
- [ ] Per-set manifests exist for every scraped set (at `output/mtg/{SET}/manifest.json`)
- [ ] Each per-set manifest has correct card count matching downloaded images
- [ ] The `validate` CLI command confirms all manifests are well-formed
- [ ] State file (`scrape-state.json`) is updated with MTG set entries

## Technical Details

### Architecture

The scraper pipeline in `tools/card-scraper/card_scraper/scraper.py` has 4 phases:
1. **Discover sets** — adapters return `SetInfo` list
2. **Fetch cards** — adapters return `MTGCardData` per set (adapter priority chain)
3. **Download images** — async concurrent downloads with retry
4. **Generate manifests** — per-set + root manifest JSON files

The critical bug is in phase 2: adapters silently return empty lists for MTG sets, and phase 4 filters out sets with 0 cards.

### Key Files

**Scraper core:**
- `tools/card-scraper/card_scraper/scraper.py` — orchestrator (fix error aggregation, progress UX)
- `tools/card-scraper/card_scraper/downloader.py` — image downloads (fix progress display)
- `tools/card-scraper/card_scraper/config.py` — config parsing (add category filter)
- `tools/card-scraper/card_scraper/manifest.py` — base manifest utils

**MTG-specific:**
- `tools/card-scraper/card_scraper/games/mtg/adapters/scryfall_bulk.py` — primary adapter (debug & fix)
- `tools/card-scraper/card_scraper/games/mtg/adapters/scryfall_api.py` — fallback adapter (fix pagination)
- `tools/card-scraper/card_scraper/games/mtg/manifest_template.py` — MTG manifest generation (add full metadata)
- `tools/card-scraper/card_scraper/games/mtg/models.py` — MTG data model (add legalities field)

**Frontend adapter:**
- `packages/frontend/src/assets/manifest/` — manifest parser (extend for MTG metadata)

### Known Silent Failure Points

| Location | Issue |
|----------|-------|
| `scraper.py:225` | Set discovery adapter failure → warning only |
| `scraper.py:262` | Card fetch failure → warning only, falls through |
| `scryfall_bulk.py:136` | Card parse exception → card silently skipped |
| `scryfall_api.py:119-129` | Missing `next_page` but `has_more=true` → silent truncation |
| `mtgjson.py:48-50` | File not found → empty dict, no error |
| `downloader.py:75` | File exists → skip without validation |

### Set Type Categories (Scryfall → ManaMesh)

Common set types to support filtering:
- `core`, `expansion` — Standard legal sets
- `commander` — Commander precons
- `masters` — Reprint sets (Modern Masters, etc.)
- `draft_innovation` — Draft-focused (Conspiracy, etc.)
- `promo`, `token`, `memorabilia` — Non-gameplay
- `funny` — Joke sets (Unglued, etc.)
- `alchemy`, `spellbook`, `arsenal` — Digital/special

## Files to Create/Modify

**Modified Files:**
- `tools/card-scraper/card_scraper/scraper.py` — error aggregation, summary tables, verbose flag, progress UX
- `tools/card-scraper/card_scraper/downloader.py` — compact progress mode, verbose toggle
- `tools/card-scraper/card_scraper/config.py` — category filter parsing, verbose config
- `tools/card-scraper/card_scraper/games/mtg/adapters/scryfall_bulk.py` — fix card fetch, improve error handling
- `tools/card-scraper/card_scraper/games/mtg/adapters/scryfall_api.py` — fix pagination, improve error handling
- `tools/card-scraper/card_scraper/games/mtg/manifest_template.py` — add legalities, validate schema
- `tools/card-scraper/card_scraper/games/mtg/models.py` — add legalities field
- `tools/card-scraper/card_scraper/cli.py` — add `--categories` and `--verbose` flags
- `tools/card-scraper/config.yaml` — add categories example
- `packages/frontend/src/assets/manifest/` — extend parser for MTG metadata fields

**New Files:**
- None expected (all changes are to existing files)

## Inventory Check

Before starting, verify:
- [ ] `tools/card-scraper/` directory exists with current scraper code
- [ ] `config.yaml` is readable and has MTG game configuration
- [ ] Scryfall API is accessible (test: `curl https://api.scryfall.com/sets`)
- [ ] Python environment has required dependencies (httpx, rich, pyyaml, fflate)
- [ ] `packages/frontend/src/assets/manifest/` manifest parser exists

## Completion Criteria

- [ ] All acceptance criteria met across all user stories
- [ ] `python -m card_scraper scrape --game mtg` produces manifests for all configured sets
- [ ] `python -m card_scraper validate --game mtg` passes
- [ ] MTG manifests loadable in frontend Asset Pack Manager via zip upload
- [ ] No regressions in One Piece scraping
- [ ] Terminal progress stays visible (no scrolling past bottom)
- [ ] Double-faced cards have both face images and manifest entries

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
