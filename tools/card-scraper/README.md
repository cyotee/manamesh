# ManaMesh Card Scraper

Multi-game card scraper and asset pack builder for ManaMesh. Supports **One Piece TCG** and **Magic: The Gathering**.

This directory contains a standalone Python package (`card-scraper`) that you can run locally to download card images and generate ManaMesh-compatible asset pack manifests.

## Running Locally (from this repository)

This scraper lives inside the `manamesh` submodule:

```bash
# From the root of the manamesh-games repository
cd packages/manamesh/tools/card-scraper
```

### 1. Prerequisites

- Python 3.10 or newer
- pip (or pipx / uv)

### 2. Setup / Installation

```bash
# Create and activate a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate   # macOS / Linux
# .venv\Scripts\activate    # Windows

# Install the package in editable mode (with dev dependencies for testing)
pip install -e ".[dev]"
```

You can also install without the virtualenv if you prefer (not recommended for long term):

```bash
pip install -e .
```

### 3. Basic Usage

Copy the example config and edit it:

```bash
cp config.example.yaml config.yaml
# Edit config.yaml to enable/disable sources, choose sets, etc.
```

Run a scrape:

```bash
# Scrape MTG (default in the example config)
python -m card_scraper scrape --game mtg --sets LCI,MKM

# Or scrape everything configured for the default game
python -m card_scraper scrape

# Scrape One Piece
python -m card_scraper --game onepiece scrape

# Force a full re-scrape (ignore previous state)
python -m card_scraper scrape --force

# Verbose logging
python -m card_scraper -v scrape
python -m card_scraper -vv scrape
```

Other useful commands:

```bash
# See what has been scraped before
python -m card_scraper --game mtg status

# Validate the generated manifests
python -m card_scraper validate

# Remove generated output and state (start fresh)
python -m card_scraper clean
```

### Output

By default, results go to:

```
output/
  <game>/                 # e.g. mtg or onepiece
    manifest.json         # Root manifest
    <SET-ID>/
      manifest.json       # Per-set manifest
      cards/
        <card>.jpg
        ...
```

These can be loaded by the frontend asset system or uploaded to IPFS.

## Configuration

See the full example and comments in `config.example.yaml`.

Key sections:

- `game` — default game (`mtg` or `onepiece`)
- `games.<game>.sources` — list of data sources with priority and rate limits
- `games.<game>.scrape` — which sets/categories to fetch
- `output.base_dir` and `state.state_file`

For MTG, the primary source is Scryfall bulk data (~501 MB). It is cached locally.

## Running from the Monorepo Root (alternative)

If you want to run it without `cd`ing every time:

```bash
cd packages/manamesh/tools/card-scraper
python -m card_scraper ...
```

Or use the full path:

```bash
python -m card_scraper -c packages/manamesh/tools/card-scraper/config.yaml scrape
```

## Development & Testing

```bash
# Install dev deps (includes pytest, respx, etc.)
pip install -e ".[dev]"

# Run the test suite
pytest

# Run with verbose output
pytest -v
```

The test suite uses mocked HTTP responses so it runs without network access.

## Architecture Overview

```
card_scraper/
├── cli.py              # Command-line entry point
├── scraper.py          # Main orchestration
├── adapters.py         # Adapter registry + protocol
├── downloader.py       # Async image downloader + retries
├── config.py           # YAML configuration loader
├── manifest.py         # Manifest generation
├── state.py            # Incremental scrape state (JSON)
├── models.py           # Shared dataclasses
└── games/
    ├── mtg/            # MTG adapters (scryfall-bulk, scryfall-api, mtgjson)
    └── onepiece/       # One Piece adapters
```

See the full README content in the original file or the code for more details on each adapter.

## Relationship to the Browser Version

A browser-based version of this functionality (scrape + pack building) is available in:

```
packages/manamesh-asset-pack-builder/
```

That package is meant to be served statically over IPFS. The Python version here remains the most robust option for large/complete archives.

## Notes

- Scraped images and output are intentionally **not** committed (see `.gitignore` rules inside this directory and the parent `manamesh` package).
- Respect API rate limits. The config lets you tune `rate_limit_ms` per source.
- For very large scrapes, the Scryfall bulk adapter is preferred because it avoids rate limits.

For questions or contributions, see the root repository.