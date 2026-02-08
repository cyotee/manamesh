# ManaMesh Card Scraper

Multi-game card scraper and asset pack builder for ManaMesh. Supports **One Piece TCG** and **Magic: The Gathering**.

## Setup

```bash
cd tools/card-scraper
pip install -e ".[dev]"
```

Requires Python 3.10+.

## Usage

```bash
# Copy and customize config
cp config.example.yaml config.yaml

# Scrape MTG cards (default game in config.example.yaml)
python -m card_scraper scrape --game mtg --sets MKM,LCI

# Scrape One Piece TCG
python -m card_scraper scrape --game onepiece

# Scrape all sets for the default game
python -m card_scraper scrape

# Force re-scrape (ignore previous state)
python -m card_scraper scrape --force

# Check scrape status
python -m card_scraper status --game mtg

# Validate generated manifests
python -m card_scraper validate

# Clean output and state files
python -m card_scraper clean
```

## Configuration

The `config.yaml` supports a multi-game structure:

```yaml
game: mtg  # Default game (override with --game flag)

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
      - name: vegapull-records
        enabled: true
        priority: 3
        local_path: ./data/vegapull-records/

  mtg:
    sources:
      - name: scryfall-bulk      # Primary: bulk data (~501 MB)
        enabled: true
        priority: 1
        bulk_ttl_hours: 24
        image_size: normal        # small, normal, large, png, border_crop, art_crop
      - name: scryfall-api        # Incremental updates
        enabled: true
        priority: 2
        rate_limit_ms: 100
      - name: mtgjson             # Data enrichment (no images)
        enabled: false
        priority: 3
        local_path: ./data/mtgjson/AllPrintings.json
    scrape:
      sets: all
      categories: [core, expansion, commander]

output:
  base_dir: ./output/
state:
  state_file: ./state/scrape-state.json
```

### Migrating from onepiece-scraper

If you have an existing `config.yaml` from `tools/onepiece-scraper/`, the new config loader supports the legacy single-game format. Your existing config will be treated as a `onepiece` game config. To use both games, wrap your existing sources under `games.onepiece` and add an `mtg` section.

## MTG Data Sources

### Scryfall Bulk (Primary)

Downloads the ~501 MB Default Cards JSON from Scryfall. No rate limits. Cached locally with configurable TTL (default: 24 hours). Best for full database imports.

### Scryfall API (Incremental)

REST API for single-set imports and incremental updates. Rate-limited to 10 req/s (configurable). Handles pagination and HTTP 429 with exponential backoff.

### MTGJSON (Enrichment)

Reads from a locally-downloaded `AllPrintings.json`. Provides cross-reference IDs (Scryfall UUID, Gatherer ID, MTGO ID, Arena ID, TCGplayer ID). Does not provide images.

To download MTGJSON data:
```bash
mkdir -p data/mtgjson
curl -L https://mtgjson.com/api/v5/AllPrintings.json.xz -o data/mtgjson/AllPrintings.json.xz
xz -d data/mtgjson/AllPrintings.json.xz
```

## Architecture

```
card_scraper/
  models.py              # Base data models (CardDataBase, SetInfo, ScrapeState)
  adapters.py            # Adapter protocol + registry
  config.py              # Multi-game YAML config
  scraper.py             # Pipeline orchestrator
  downloader.py          # Async image downloader with retry
  manifest.py            # Base manifest utilities
  state.py               # JSON-backed state tracker
  cli.py                 # CLI (argparse + Rich)
  games/
    onepiece/
      models.py          # OnePieceCardData
      manifest_template.py
      adapters/           # optcg_api, ryan_api, vegapull_records
    mtg/
      models.py          # MTGCardData
      type_parser.py     # Type line parser
      manifest_template.py
      adapters/           # scryfall_bulk, scryfall_api, mtgjson
```

Adapters satisfy a `CardSourceAdapter` protocol and are registered per-game. The scraper tries adapters in priority order with fallback.

## Testing

```bash
python -m pytest tests/ -v
```

110 tests covering models, config, state, manifests, type parser, and all adapters (mocked HTTP via respx).
