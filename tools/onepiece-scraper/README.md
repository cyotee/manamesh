# One Piece TCG Card Scraper

Scrapes One Piece TCG card data and images from multiple API sources and builds ManaMesh-compatible asset packs.

## Installation

```bash
cd tools/onepiece-scraper
pip install -e ".[dev]"
```

## Configuration

```bash
cp config.example.yaml config.yaml
# Edit config.yaml to customize sources, output, etc.
```

### Source Priority

The scraper uses a fallback chain — if the primary source fails for a card or set, it tries the next source in priority order:

1. **optcg-api** (optcgapi.com) — Most comprehensive, primary source
2. **ryan-api** (optcg-api.com by ryanmichaelhirst) — Secondary fallback
3. **vegapull-records** — Static local data from GitHub releases (last resort)

### Vegapull-Records Setup

To use the vegapull-records fallback adapter:

1. Download the latest release from the vegapull-records GitHub repository
2. Extract the archive into `data/vegapull-records/`
3. The adapter will scan all `.json` files in that directory

## Usage

### Full Scrape

```bash
# Scrape all sets (uses config.yaml or defaults)
python -m onepiece_scraper scrape

# Scrape specific sets
python -m onepiece_scraper scrape --sets OP-01,OP-02

# Force re-scrape (ignore state)
python -m onepiece_scraper scrape --force

# Verbose output
python -m onepiece_scraper -v scrape
python -m onepiece_scraper -vv scrape   # debug level
```

### Check Status

```bash
python -m onepiece_scraper status
```

### Validate Manifests

```bash
python -m onepiece_scraper validate
```

### Clean Output

```bash
python -m onepiece_scraper clean
```

### Custom Config File

```bash
python -m onepiece_scraper -c /path/to/config.yaml scrape
```

## Output Structure

```
output/onepiece/
  manifest.json                    # Root manifest (SetReference entries)
  OP-01/
    manifest.json                  # Per-set manifest (CardManifestEntry items)
    cards/
      OP01-001.jpg
      OP01-002.jpg
  ST-01/
    manifest.json
    cards/
      ...
  PROMO/
    manifest.json
    cards/
      ...
```

Generated manifests conform to the ManaMesh `AssetPackManifest` schema defined in `packages/frontend/src/assets/manifest/types.ts`.

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run tests with verbose output
pytest -v
```

## Architecture

The scraper uses a pluggable adapter pattern:

- **`adapters/base.py`** — `CardSourceAdapter` protocol (duck-typed interface)
- **`adapters/optcg_api.py`** — Primary adapter for optcgapi.com
- **`adapters/ryan_api.py`** — Secondary adapter for ryanmichaelhirst API
- **`adapters/vegapull_records.py`** — Static fallback from local JSON files
- **`scraper.py`** — Orchestrator that coordinates adapters, downloads, and manifests
- **`downloader.py`** — Async image downloader with retry and concurrency
- **`manifest.py`** — ManaMesh manifest generator
- **`state.py`** — Incremental state tracker (JSON-backed)
- **`config.py`** — YAML config loader with validation
- **`cli.py`** — CLI interface with Rich progress bars
