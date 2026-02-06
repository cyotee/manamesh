# Task MM-037: One Piece Card Scraper & Asset Pack Builder

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-06
**Dependencies:** MM-033 (Complete)
**Worktree:** `feature/onepiece-card-scraper`

---

## Description

Build a modular Python scraper tool that downloads One Piece TCG card data and images from multiple API sources, then constructs ManaMesh-compatible asset packs with per-set directory structure and manifests. The scraper uses a pluggable adapter architecture so new sources can be added easily, with YAML-based configuration for source priority/fallback order.

This task builds directly on the MM-033 research, which identified OPTCG API (optcgapi.com) as the primary source, ryanmichaelhirst API as secondary, and vegapull-records as a static fallback.

## Dependencies

- **MM-033** (Complete) - One Piece Card Data Sources Research. Provides the API documentation, field mappings, and source recommendations used to build the adapters.

## User Stories

### US-MM-037.1: Modular Source Adapter Framework

As a developer, I want a pluggable adapter system so that I can add new card data sources without modifying the core scraper.

**Acceptance Criteria:**
- [ ] Define a `CardSourceAdapter` abstract base class / protocol with methods:
  - `list_sets() -> list[SetInfo]`
  - `get_cards(set_id: str) -> list[CardData]`
  - `get_image_url(card_id: str) -> str`
  - `name` property for logging
- [ ] Each adapter is a separate Python module in `tools/onepiece-scraper/adapters/`
- [ ] Adapters are discovered and loaded by name from YAML config
- [ ] Fallback chain: if primary adapter fails for a card/set, try the next adapter in order
- [ ] Per-adapter rate limiting configuration

### US-MM-037.2: OPTCG API Adapter (Primary)

As a developer, I want an adapter for optcgapi.com so that I can scrape the most comprehensive One Piece card data source.

**Acceptance Criteria:**
- [ ] Implement `OptcgApiAdapter` using the endpoints documented in MM-033:
  - `/api/allSets/` - list all sets
  - `/api/sets/{id}/` - cards in a set
  - `/api/allSTCards/` - starter deck cards
  - `/api/allPromoCards/` - promo cards
- [ ] Map API fields to `CardData` model:
  - `card_set_id` -> `id`
  - `card_name` -> `name`
  - `card_type` -> `card_type`
  - `card_cost` -> `cost`
  - `card_power` -> `power`
  - `card_color` -> `colors` (parse multi-color)
  - `card_image` -> `image_url`
  - `rarity` -> `rarity`
  - `card_text` -> `text`
  - `sub_types` -> `traits`
  - `life` -> `life` (leaders only)
  - `counter_amount` -> `counter`
- [ ] Image URL pattern: `https://optcgapi.com/media/static/Card_Images/{card_id}.jpg`
- [ ] Handle pagination if any endpoints paginate
- [ ] Respect informal rate limits (add configurable delay between requests)

### US-MM-037.3: ryanmichaelhirst API Adapter (Secondary)

As a developer, I want an adapter for the ryanmichaelhirst OPTCG API so that I have a fallback data source.

**Acceptance Criteria:**
- [ ] Implement `RyanApiAdapter` using:
  - `/api/v1/cards` - paginated card list
  - `/api/v1/cards/{id}` - single card
  - Query params: `page`, `per_page`, `search`, `color`, `set`, `type`, etc.
- [ ] Map API fields to `CardData` model:
  - `code` -> `id`
  - `name` -> `name`
  - `type` -> `card_type`
  - `cost` -> `cost`
  - `power` -> `power`
  - `color` -> `colors`
  - `image` -> `image_url`
  - `rarity` -> `rarity`
  - `effect` -> `text`
  - `class` -> `traits`
- [ ] Handle pagination (page/per_page params)
- [ ] Used as fallback when OPTCG API fails for specific cards

### US-MM-037.4: Vegapull-Records Adapter (Static Fallback)

As a developer, I want an adapter for vegapull-records GitHub releases so that I have a static data fallback.

**Acceptance Criteria:**
- [ ] Implement `VegapullRecordsAdapter` that reads from locally-downloaded vegapull-records archives
- [ ] Support configuring the local path to the vegapull-records data directory
- [ ] Parse the vegapull JSON format into `CardData` model
- [ ] Used as last-resort fallback for cards missing from API sources
- [ ] Document how to download vegapull-records releases for local use

### US-MM-037.5: YAML Configuration

As a developer, I want a YAML config file so that I can control which adapters to use, their priority, and output settings.

**Acceptance Criteria:**
- [ ] Config file at `tools/onepiece-scraper/config.yaml` (with `config.example.yaml` committed)
- [ ] Configuration schema:
  ```yaml
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

  output:
    base_dir: ./output/onepiece/
    image_format: original  # download as-is
    manifest_version: "1.0"

  scrape:
    sets: all              # or list of set IDs
    include_starters: true
    include_promos: true

  state:
    state_file: ./state/scrape-state.json
  ```
- [ ] CLI can override config values (e.g., `--sets OP-01,OP-02`)
- [ ] Validate config on startup with clear error messages

### US-MM-037.6: Image Downloader

As a developer, I want the scraper to download card images so that the asset pack includes all card faces.

**Acceptance Criteria:**
- [ ] Download images from the URL provided by the active adapter
- [ ] Save to `{output_dir}/{set_id}/cards/{card_id}.{ext}`
- [ ] Skip already-downloaded images (check state file)
- [ ] Retry failed downloads (3 attempts with exponential backoff)
- [ ] Log download progress (X/Y cards for each set)
- [ ] Configurable concurrent download limit

### US-MM-037.7: Asset Pack Manifest Generation

As a developer, I want the scraper to generate ManaMesh-compatible manifests so that the output can be loaded by the frontend asset system.

**Acceptance Criteria:**
- [ ] Generate root `manifest.json` following `AssetPackManifest` schema:
  ```json
  {
    "name": "One Piece TCG - Complete",
    "version": "1.0.0",
    "game": "onepiece",
    "sets": [
      { "name": "Romance Dawn", "path": "OP-01" },
      { "name": "Paramount War", "path": "OP-02" }
    ]
  }
  ```
- [ ] Generate per-set `{set_id}/manifest.json` with `CardManifestEntry` items:
  ```json
  {
    "name": "One Piece TCG - Romance Dawn",
    "version": "1.0.0",
    "game": "onepiece",
    "cards": [
      {
        "id": "OP01-001",
        "name": "Roronoa Zoro",
        "front": "cards/OP01-001.jpg",
        "metadata": {
          "cardType": "character",
          "cost": 3,
          "power": 5000,
          "colors": ["Red"],
          "rarity": "SR",
          "traits": ["Supernovas", "Straw Hat Crew"],
          "text": "...",
          "counter": 1000
        }
      }
    ]
  }
  ```
- [ ] Also generate starter deck and promo manifests as separate sets
- [ ] Validate generated manifests match the schema from `packages/frontend/src/assets/manifest/types.ts`

### US-MM-037.8: Incremental State Tracking

As a developer, I want the scraper to track its state so that re-runs only download new or changed cards.

**Acceptance Criteria:**
- [ ] State file at `{state_dir}/scrape-state.json` tracks:
  - Last scrape timestamp per set
  - List of downloaded card IDs per set
  - Image download status per card (success/failed/pending)
- [ ] On re-run, only fetch cards not in state file
- [ ] `--force` flag to ignore state and re-scrape everything
- [ ] `--set OP-01` flag to re-scrape a specific set
- [ ] State file is human-readable JSON for debugging

### US-MM-037.9: CLI Interface

As a developer, I want a CLI interface so that I can run the scraper from the command line.

**Acceptance Criteria:**
- [ ] Entry point: `python -m onepiece_scraper` or `python tools/onepiece-scraper/main.py`
- [ ] Commands:
  - `scrape` - Run the full scrape pipeline (list sets -> fetch cards -> download images -> generate manifests)
  - `scrape --sets OP-01,OP-02` - Scrape specific sets only
  - `scrape --force` - Ignore state, re-scrape everything
  - `status` - Show scrape state (sets scraped, cards per set, images downloaded)
  - `validate` - Validate generated manifests against schema
  - `clean` - Remove output directory and state file
- [ ] Progress bars for long-running operations (use `rich` or `tqdm`)
- [ ] Structured logging with configurable verbosity (`-v`, `-vv`)

## Technical Details

### Directory Structure

```
tools/
  onepiece-scraper/
    pyproject.toml            # Python project config (dependencies, scripts)
    config.example.yaml       # Example configuration (committed)
    config.yaml               # Local config (gitignored)
    README.md                 # Usage documentation
    onepiece_scraper/
      __init__.py
      __main__.py             # CLI entry point
      cli.py                  # argparse/click CLI definition
      config.py               # YAML config loader + validation
      models.py               # CardData, SetInfo, ScrapeState data models
      scraper.py              # Core scrape orchestrator
      downloader.py           # Image download with retry/concurrency
      manifest.py             # ManaMesh manifest generator
      state.py                # Incremental state tracker
      adapters/
        __init__.py
        base.py               # CardSourceAdapter protocol/ABC
        optcg_api.py          # OPTCG API adapter
        ryan_api.py           # ryanmichaelhirst adapter
        vegapull_records.py   # Vegapull-records adapter
    tests/
      test_models.py
      test_config.py
      test_manifest.py
      test_optcg_adapter.py   # With mocked HTTP responses
      test_ryan_adapter.py
      test_state.py
    output/                   # Generated asset packs (gitignored)
    state/                    # Scrape state files (gitignored)
    data/                     # Local data for vegapull-records (gitignored)
```

### Data Models

```python
from dataclasses import dataclass, field

@dataclass
class SetInfo:
    id: str           # e.g. "OP-01"
    name: str         # e.g. "Romance Dawn"
    category: str     # "booster", "starter", "promo", "extra"

@dataclass
class CardData:
    id: str              # e.g. "OP01-001"
    name: str
    card_type: str       # "character", "leader", "event", "stage", "don"
    cost: int | None
    power: int | None
    counter: int | None
    colors: list[str]
    rarity: str
    traits: list[str]
    text: str
    life: int | None     # leaders only
    image_url: str
    set_id: str
    source: str          # which adapter provided this data
```

### Adapter Protocol

```python
from typing import Protocol

class CardSourceAdapter(Protocol):
    @property
    def name(self) -> str: ...

    async def list_sets(self) -> list[SetInfo]: ...

    async def get_cards(self, set_id: str) -> list[CardData]: ...

    def get_image_url(self, card: CardData) -> str: ...
```

### Key Dependencies

```
httpx           # Async HTTP client
pyyaml          # YAML config parsing
rich            # CLI progress bars and logging
pydantic        # Config validation (optional, can use dataclasses)
pytest          # Testing
pytest-asyncio  # Async test support
respx           # HTTP mocking for tests
```

### Output Structure (matches frontend AssetPackManifest)

```
output/onepiece/
  manifest.json                    # Root manifest with SetReference entries
  OP-01/
    manifest.json                  # Per-set manifest with CardManifestEntry items
    cards/
      OP01-001.jpg
      OP01-002.jpg
      ...
  OP-02/
    manifest.json
    cards/
      ...
  ST-01/
    manifest.json
    cards/
      ...
  PROMO/
    manifest.json
    cards/
      ...
```

### Mapping from OPTCG API to ManaMesh Manifest

| OPTCG API Field | CardData Field | Manifest Location |
|-----------------|---------------|-------------------|
| `card_set_id` | `id` | `cards[].id` |
| `card_name` | `name` | `cards[].name` |
| `card_image` (path) | `image_url` | `cards[].front` (local path after download) |
| `card_type` | `card_type` | `cards[].metadata.cardType` |
| `card_cost` | `cost` | `cards[].metadata.cost` |
| `card_power` | `power` | `cards[].metadata.power` |
| `card_color` | `colors` | `cards[].metadata.colors` |
| `rarity` | `rarity` | `cards[].metadata.rarity` |
| `sub_types` | `traits` | `cards[].metadata.traits` |
| `card_text` | `text` | `cards[].metadata.text` |
| `counter_amount` | `counter` | `cards[].metadata.counter` |
| `life` | `life` | `cards[].metadata.life` |

### Multi-Color Parsing

OPTCG API returns colors as a single string (e.g., "Red/Green"). Parse by splitting on `/`:
```python
colors = card_color.split("/") if "/" in card_color else [card_color]
```

## Files to Create/Modify

**New Files:**
- `tools/onepiece-scraper/pyproject.toml` - Python project configuration
- `tools/onepiece-scraper/config.example.yaml` - Example config
- `tools/onepiece-scraper/README.md` - Usage documentation
- `tools/onepiece-scraper/onepiece_scraper/__init__.py`
- `tools/onepiece-scraper/onepiece_scraper/__main__.py`
- `tools/onepiece-scraper/onepiece_scraper/cli.py`
- `tools/onepiece-scraper/onepiece_scraper/config.py`
- `tools/onepiece-scraper/onepiece_scraper/models.py`
- `tools/onepiece-scraper/onepiece_scraper/scraper.py`
- `tools/onepiece-scraper/onepiece_scraper/downloader.py`
- `tools/onepiece-scraper/onepiece_scraper/manifest.py`
- `tools/onepiece-scraper/onepiece_scraper/state.py`
- `tools/onepiece-scraper/onepiece_scraper/adapters/__init__.py`
- `tools/onepiece-scraper/onepiece_scraper/adapters/base.py`
- `tools/onepiece-scraper/onepiece_scraper/adapters/optcg_api.py`
- `tools/onepiece-scraper/onepiece_scraper/adapters/ryan_api.py`
- `tools/onepiece-scraper/onepiece_scraper/adapters/vegapull_records.py`
- `tools/onepiece-scraper/tests/test_models.py`
- `tools/onepiece-scraper/tests/test_config.py`
- `tools/onepiece-scraper/tests/test_manifest.py`
- `tools/onepiece-scraper/tests/test_optcg_adapter.py`
- `tools/onepiece-scraper/tests/test_ryan_adapter.py`
- `tools/onepiece-scraper/tests/test_state.py`

**Modified Files:**
- `.gitignore` - Add `tools/onepiece-scraper/output/`, `tools/onepiece-scraper/state/`, `tools/onepiece-scraper/data/`, `tools/onepiece-scraper/config.yaml`

## Inventory Check

Before starting, verify:
- [ ] Python 3.11+ installed
- [ ] MM-033 research document available for API reference
- [ ] OPTCG API accessible (test: `curl https://optcgapi.com/api/allSets/`)
- [ ] Existing asset manifest types in `packages/frontend/src/assets/manifest/types.ts` for schema reference

## Completion Criteria

- [ ] All three adapters implemented and tested
- [ ] YAML config loading and validation works
- [ ] `scrape` command downloads cards and images from all categories
- [ ] Incremental state tracking prevents re-downloading
- [ ] Generated manifests match ManaMesh `AssetPackManifest` schema
- [ ] Per-set directory structure with images is correct
- [ ] CLI provides progress feedback and status reporting
- [ ] Tests pass with mocked HTTP responses
- [ ] README documents installation, configuration, and usage

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
