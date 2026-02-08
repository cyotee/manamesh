# Task MM-042: MTG Card Scraper & Multi-Game Tool Refactor

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-08
**Dependencies:** MM-037, MM-041
**Worktree:** `feature/mtg-card-scraper`

---

## Description

Refactor the existing One Piece scraper tool (`tools/onepiece-scraper/`) into a multi-game card scraper (`tools/card-scraper/`) and add MTG adapter modules. The Scryfall adapter is the primary data + image source, with an optional MTGJSON adapter for data enrichment. This task builds on the MM-041 research findings and extends the adapter architecture established in MM-037.

The refactored tool keeps all existing One Piece functionality working while adding MTG support via a `--game` CLI flag and game-specific adapter directories.

## Dependencies

- **MM-037** (Complete) - One Piece Card Scraper & Asset Pack Builder. Provides the existing tool with adapter architecture, downloader, state tracker, and manifest generator.
- **MM-041** (In Progress) - MTG Card Data Sources Research. Provides API documentation, field mappings, Scryfall/MTGJSON evaluation, and adapter architecture recommendation.

## User Stories

### US-042.1: Refactor to Multi-Game Tool

As a developer, I want the scraper tool refactored from `onepiece-scraper` to `card-scraper` so that it supports multiple card games with shared infrastructure.

**Acceptance Criteria:**
- [ ] Rename `tools/onepiece-scraper/` to `tools/card-scraper/`
- [ ] Rename Python package from `onepiece_scraper` to `card_scraper`
- [ ] Restructure adapters into `card_scraper/games/onepiece/adapters/` and `card_scraper/games/mtg/adapters/`
- [ ] Extract base `CardDataBase` model with game-specific subclasses (`OnePieceCardData`, `MTGCardData`)
- [ ] Add `--game {onepiece|mtg}` flag to CLI (default: from config)
- [ ] Multi-game config structure in `config.yaml` (game-specific source lists)
- [ ] All existing One Piece functionality still works after refactor
- [ ] Existing One Piece tests pass without modification (beyond import path changes)
- [ ] Update `pyproject.toml` with new package name and any new dependencies
- [ ] Update README.md with multi-game usage

### US-042.2: Scryfall Bulk Data Adapter

As a developer, I want a Scryfall adapter that downloads the bulk data file and parses it locally so that I can import the entire MTG card database without rate limit concerns.

**Acceptance Criteria:**
- [ ] Implement `ScryfallBulkAdapter` in `card_scraper/games/mtg/adapters/scryfall_bulk.py`
- [ ] Download `Default Cards` bulk JSON (~501 MB) from Scryfall `/bulk-data` endpoint
- [ ] Cache bulk file locally with timestamp; re-download if older than configured TTL (default: 24 hours)
- [ ] Parse JSON into `MTGCardData` objects with full field mapping (see Field Mapping section)
- [ ] Parse `type_line` string into separate `types`, `subtypes`, `supertypes` arrays
- [ ] Handle multi-face cards: populate `card_faces` array with per-face data
- [ ] Extract `image_uris.{size}` as `image_url` (configurable size: small/normal/large/png)
- [ ] Support set filtering: only process cards matching configured set codes or categories
- [ ] `list_sets()`: extract unique sets from bulk data
- [ ] `get_cards(set_id)`: filter bulk data for cards in the given set
- [ ] `get_image_url(card)`: return URL for configured image size
- [ ] Unit tests with a fixture of 10-20 sample Scryfall card objects (mocked, not live API)

### US-042.3: Scryfall REST API Adapter

As a developer, I want a Scryfall REST API adapter for incremental updates and single-card lookups so that I can update specific sets without re-downloading the full bulk file.

**Acceptance Criteria:**
- [ ] Implement `ScryfallApiAdapter` in `card_scraper/games/mtg/adapters/scryfall_api.py`
- [ ] `list_sets()`: call `GET /sets`, return `SetInfo` objects
- [ ] `get_cards(set_id)`: call `GET /cards/search?q=set:{set_id}` with pagination (175 cards/page)
- [ ] `get_image_url(card)`: return URL for configured image size
- [ ] Respect rate limit: configurable delay (default: 100ms between requests)
- [ ] Handle HTTP 429 with exponential backoff (3 retries)
- [ ] Set `User-Agent` header per Scryfall requirements (e.g., `ManaMesh-CardScraper/1.0`)
- [ ] Parse responses into `MTGCardData` using same field mapping as bulk adapter
- [ ] Unit tests with mocked HTTP responses (use `respx`)

### US-042.4: MTGJSON Adapter (Optional Secondary)

As a developer, I want an MTGJSON adapter for data enrichment so that I can supplement Scryfall data with cross-reference identifiers.

**Acceptance Criteria:**
- [ ] Implement `MtgjsonAdapter` in `card_scraper/games/mtg/adapters/mtgjson.py`
- [ ] Load from locally-downloaded `AllPrintings.json` (configurable path)
- [ ] Parse into `MTGCardData` with field mapping (see Field Mapping section)
- [ ] Provide cross-reference identifiers: Scryfall UUID, Gatherer ID, MTGO ID, Arena ID, TCGplayer ID
- [ ] Used as fallback/enrichment source (not primary)
- [ ] Document how to download MTGJSON files for local use
- [ ] Unit tests with fixture data

### US-042.5: MTG Type Line Parser

As a developer, I want a robust parser for Scryfall's `type_line` field so that `types`, `subtypes`, and `supertypes` arrays are correctly populated.

**Acceptance Criteria:**
- [ ] Implement `parse_type_line(type_line: str)` in `card_scraper/games/mtg/type_parser.py`
- [ ] Returns `TypeLineResult` with `supertypes: list[str]`, `types: list[str]`, `subtypes: list[str]`
- [ ] Handles standard patterns:
  - `"Instant"` -> types: `["Instant"]`, subtypes: `[]`, supertypes: `[]`
  - `"Legendary Creature — Elf Warrior"` -> supertypes: `["Legendary"]`, types: `["Creature"]`, subtypes: `["Elf", "Warrior"]`
  - `"Artifact Creature — Construct"` -> types: `["Artifact", "Creature"]`, subtypes: `["Construct"]`
  - `"Legendary Planeswalker — Jace"` -> supertypes: `["Legendary"]`, types: `["Planeswalker"]`, subtypes: `["Jace"]`
  - `"Basic Land — Island"` -> supertypes: `["Basic"]`, types: `["Land"]`, subtypes: `["Island"]`
  - `"Legendary Snow Creature — Giant Berserker"` -> supertypes: `["Legendary", "Snow"]`, types: `["Creature"]`, subtypes: `["Giant", "Berserker"]`
- [ ] Handles multi-face type lines: `"Creature — Human Scout // Creature — Human Rogue"` (split on ` // `)
- [ ] Known supertypes list: `Basic`, `Legendary`, `Snow`, `World`, `Ongoing`, `Host`
- [ ] Known types list: `Artifact`, `Battle`, `Creature`, `Enchantment`, `Instant`, `Kindred`, `Land`, `Planeswalker`, `Sorcery` (plus `Conspiracy`, `Dungeon`, `Phenomenon`, `Plane`, `Scheme`, `Vanguard`)
- [ ] Comprehensive unit tests covering all edge cases (20+ test cases)

### US-042.6: MTG Manifest Templates

As a developer, I want MTG-specific manifest generation so that asset packs follow the ManaMesh format with MTG card metadata.

**Acceptance Criteria:**
- [ ] Implement MTG manifest template in `card_scraper/games/mtg/manifest_template.py`
- [ ] Root manifest with set listing (name, code, path, category derived from Scryfall `set_type`)
- [ ] Per-set manifest with `CardManifestEntry` items including MTG-specific metadata:
  - `manaCost`, `cmc`, `types`, `subtypes`, `supertypes`
  - `power`, `toughness`, `loyalty` (as strings)
  - `colors`, `colorIdentity`, `rarity`, `keywords`
  - `layout`, `oracleText`
- [ ] Multi-face cards: single entry with `front` and `back` image paths, `faces[]` in metadata
- [ ] Set category mapping from Scryfall `set_type` to ManaMesh categories (core, expansion, commander, masters, supplemental, promo, token)
- [ ] Image file naming: `{SET}-{COLLECTOR_NUMBER}.{ext}` (e.g., `MKM-001.jpg`)
- [ ] Multi-face image naming: `{SET}-{NUM}-front.{ext}`, `{SET}-{NUM}-back.{ext}`
- [ ] Generated manifests validate against `packages/frontend/src/assets/manifest/types.ts` schema
- [ ] Unit tests with fixture data

### US-042.7: MTG Image Downloader Integration

As a developer, I want the existing image downloader to work with MTG cards including multi-face images so that asset packs include all card artwork.

**Acceptance Criteria:**
- [ ] Existing downloader handles MTG image URLs (Scryfall CDN, no rate limit)
- [ ] Multi-face cards: download both front and back images
- [ ] Configurable image size via config (small, normal, large, png, border_crop, art_crop)
- [ ] Skip already-downloaded images via state tracker
- [ ] Respect Scryfall image policies (preserve copyright/artist name)
- [ ] Log: `"Downloading MKM (Murders at Karlov Manor): 42/286 cards"` per set

### US-042.8: Multi-Game Configuration

As a developer, I want a YAML config that supports both One Piece and MTG sources so that either game can be scraped with the same tool.

**Acceptance Criteria:**
- [ ] Config file at `tools/card-scraper/config.example.yaml` with multi-game structure:
  ```yaml
  game: mtg  # Default game to scrape

  games:
    onepiece:
      sources:
        - name: optcg-api
          enabled: true
          priority: 1
          rate_limit_ms: 200
        - name: ryan-api
          enabled: true
          priority: 2
          rate_limit_ms: 500
        - name: vegapull-records
          enabled: true
          priority: 3
          local_path: ./data/vegapull-records/
      scrape:
        sets: all
        include_starters: true
        include_promos: true

    mtg:
      sources:
        - name: scryfall-bulk
          enabled: true
          priority: 1
          bulk_ttl_hours: 24
          image_size: normal
        - name: scryfall-api
          enabled: true
          priority: 2
          rate_limit_ms: 100
          image_size: normal
        - name: mtgjson
          enabled: false
          priority: 3
          local_path: ./data/mtgjson/AllPrintings.json
      scrape:
        sets: all
        categories: [core, expansion, commander]
        include_tokens: false

  output:
    base_dir: ./output/
    manifest_version: "1.0"

  state:
    state_file: ./state/scrape-state.json
  ```
- [ ] CLI: `python -m card_scraper scrape --game mtg --sets MKM,LCI`
- [ ] CLI: `python -m card_scraper scrape --game onepiece` (backwards compatible)
- [ ] CLI: `python -m card_scraper status --game mtg`
- [ ] Validate config on startup with clear error messages
- [ ] Existing `config.yaml` files migrated to new format (document migration path)

## Technical Details

### Field Mapping: Scryfall -> MTGCardData

| Scryfall Field | MTGCardData Field | Transform |
|----------------|-------------------|-----------|
| `id` | `id` | UUID string |
| `name` | `name` | Direct (split on ` // ` for multi-face display name) |
| `mana_cost` | `mana_cost` | Direct string |
| `cmc` | `cmc` | Direct float |
| `type_line` | `types`, `subtypes`, `supertypes` | Parse via `parse_type_line()` |
| `power` | `power` | Direct string (may be `*`, `X`, etc.) |
| `toughness` | `toughness` | Direct string |
| `loyalty` | `loyalty` | Direct string |
| `oracle_text` | `oracle_text` | Direct string |
| `set` | `set_id` | Direct string (set code) |
| `collector_number` | `collector_number` | Direct string |
| `colors` | `colors` | Direct array `["W", "U"]` |
| `color_identity` | `color_identity` | Direct array |
| `rarity` | `rarity` | Direct string |
| `keywords` | `keywords` | Direct array |
| `layout` | `layout` | Direct string |
| `card_faces` | `card_faces` | Map each face to dict with name, mana_cost, oracle_text, type_line, power, toughness, image_uris |
| `image_uris.{size}` | `image_url` | Select based on config `image_size` |
| `set_name` | (SetInfo.name) | Used for set metadata |
| `set_type` | (SetInfo.category) | Map to ManaMesh category |

### Field Mapping: MTGJSON -> MTGCardData

| MTGJSON Field | MTGCardData Field | Transform |
|---------------|-------------------|-----------|
| `uuid` | `id` | Direct string |
| `name` | `name` | Direct string |
| `manaCost` | `mana_cost` | Direct string |
| `manaValue` | `cmc` | Direct number |
| `types` | `types` | Direct array |
| `subtypes` | `subtypes` | Direct array |
| `supertypes` | `supertypes` | Direct array |
| `power` | `power` | Direct string |
| `toughness` | `toughness` | Direct string |
| `loyalty` | `loyalty` | Direct string |
| `text` | `oracle_text` | Direct string |
| `setCode` | `set_id` | Direct string |
| `number` | `collector_number` | Direct string |
| `colors` | `colors` | Direct array |
| `colorIdentity` | `color_identity` | Direct array |
| `rarity` | `rarity` | Direct string |
| `keywords` | `keywords` | Direct array |
| `identifiers` | `cross_ref_ids` | Extract scryfall, gatherer, mtgo, arena, tcgplayer IDs |

### MTGCardData Model

```python
@dataclass
class MTGCardData(CardDataBase):
    """MTG-specific card data with typed fields."""
    mana_cost: str | None = None
    cmc: float = 0.0
    types: list[str] = field(default_factory=list)
    subtypes: list[str] = field(default_factory=list)
    supertypes: list[str] = field(default_factory=list)
    power: str | None = None          # String: can be *, X, 1+*, etc.
    toughness: str | None = None      # String: can be *, X, 1+*, etc.
    loyalty: str | None = None        # String: can be X, etc.
    oracle_text: str = ""
    colors: list[str] = field(default_factory=list)
    color_identity: list[str] = field(default_factory=list)
    layout: str = "normal"
    card_faces: list[dict] | None = None
    keywords: list[str] = field(default_factory=list)
    collector_number: str = ""
    cross_ref_ids: dict[str, str] = field(default_factory=dict)
```

### Directory Structure After Refactor

```
tools/card-scraper/
  pyproject.toml
  config.example.yaml
  README.md
  card_scraper/
    __init__.py
    __main__.py
    cli.py                           # --game flag added
    config.py                        # Multi-game config loader
    models.py                        # CardDataBase + game-specific subclasses
    scraper.py                       # Core orchestrator (game-agnostic)
    downloader.py                    # Image downloader (shared, multi-face support)
    manifest.py                      # Base manifest generator
    state.py                         # State tracker (shared)
    games/
      __init__.py
      onepiece/
        __init__.py
        adapters/
          __init__.py
          optcg_api.py               # Moved from adapters/
          ryan_api.py                # Moved from adapters/
          vegapull_records.py        # Moved from adapters/
        models.py                    # OnePieceCardData(CardDataBase)
        manifest_template.py         # One Piece manifest format
      mtg/
        __init__.py
        adapters/
          __init__.py
          scryfall_bulk.py           # NEW: Bulk data adapter
          scryfall_api.py            # NEW: REST API adapter
          mtgjson.py                 # NEW: Data enrichment adapter
        models.py                    # MTGCardData(CardDataBase)
        manifest_template.py         # NEW: MTG manifest format
        type_parser.py               # NEW: type_line parser
  tests/
    __init__.py
    test_config.py                   # Updated for multi-game
    test_models.py                   # Updated for base + subclasses
    test_manifest.py                 # Updated for multi-game
    test_state.py                    # Unchanged
    onepiece/
      __init__.py
      test_optcg_adapter.py          # Moved
      test_ryan_adapter.py           # Moved
    mtg/
      __init__.py
      test_scryfall_bulk.py          # NEW
      test_scryfall_api.py           # NEW
      test_mtgjson.py                # NEW
      test_type_parser.py            # NEW
      test_mtg_manifest.py           # NEW
  output/                            # Gitignored
  state/                             # Gitignored
  data/                              # Gitignored (bulk downloads)
```

### New Dependencies

```
# Add to pyproject.toml (existing deps: httpx, pyyaml, rich, pytest, pytest-asyncio, respx)
# No new dependencies needed — httpx handles all HTTP, pyyaml handles config
```

## Files to Create/Modify

**New Files (MTG):**
- `tools/card-scraper/card_scraper/games/mtg/__init__.py`
- `tools/card-scraper/card_scraper/games/mtg/adapters/__init__.py`
- `tools/card-scraper/card_scraper/games/mtg/adapters/scryfall_bulk.py`
- `tools/card-scraper/card_scraper/games/mtg/adapters/scryfall_api.py`
- `tools/card-scraper/card_scraper/games/mtg/adapters/mtgjson.py`
- `tools/card-scraper/card_scraper/games/mtg/models.py`
- `tools/card-scraper/card_scraper/games/mtg/manifest_template.py`
- `tools/card-scraper/card_scraper/games/mtg/type_parser.py`
- `tools/card-scraper/tests/mtg/test_scryfall_bulk.py`
- `tools/card-scraper/tests/mtg/test_scryfall_api.py`
- `tools/card-scraper/tests/mtg/test_mtgjson.py`
- `tools/card-scraper/tests/mtg/test_type_parser.py`
- `tools/card-scraper/tests/mtg/test_mtg_manifest.py`

**Refactored Files (Renamed/Moved):**
- `tools/onepiece-scraper/` -> `tools/card-scraper/`
- `onepiece_scraper/` -> `card_scraper/`
- `onepiece_scraper/adapters/` -> `card_scraper/games/onepiece/adapters/`
- `onepiece_scraper/models.py` -> split into `card_scraper/models.py` (base) + `card_scraper/games/onepiece/models.py` (One Piece specific)
- `onepiece_scraper/manifest.py` -> `card_scraper/manifest.py` (base) + `card_scraper/games/onepiece/manifest_template.py`
- Tests moved into `tests/onepiece/` subdirectory

**Modified Files:**
- `card_scraper/cli.py` - Add `--game` flag
- `card_scraper/config.py` - Multi-game config structure
- `card_scraper/scraper.py` - Game-agnostic orchestrator
- `card_scraper/downloader.py` - Multi-face image support
- `card_scraper/state.py` - Game-namespaced state tracking
- `config.example.yaml` - Multi-game config template
- `pyproject.toml` - New package name
- `README.md` - Multi-game documentation
- `.gitignore` - Update paths

## Inventory Check

Before starting, verify:
- [ ] `tools/onepiece-scraper/` exists with working code
- [ ] All existing tests pass: `cd tools/onepiece-scraper && python -m pytest`
- [ ] Python 3.11+ installed
- [ ] MM-041 research document at `RESEARCH_MTG_CardSources.md`
- [ ] Scryfall API accessible: `curl -s https://api.scryfall.com/bulk-data | python -m json.tool | head`
- [ ] Frontend manifest types at `packages/frontend/src/assets/manifest/types.ts` for schema reference

## Completion Criteria

- [ ] All acceptance criteria in US-042.1 through US-042.8 met
- [ ] Existing One Piece scraper fully functional after refactor
- [ ] Scryfall bulk adapter: full import of at least one set
- [ ] Scryfall API adapter: incremental import works
- [ ] MTGJSON adapter: loads and parses local data
- [ ] Type line parser: all edge cases covered (20+ tests)
- [ ] MTG manifests match ManaMesh schema
- [ ] Multi-face cards handled correctly (images + manifest)
- [ ] All tests pass (existing + new)
- [ ] Config migration documented in README
- [ ] CLI `--game mtg` and `--game onepiece` both work

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
