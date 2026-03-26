# Task MM-048: One Piece DON!! Card Face Scraper Sources

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-08
**Dependencies:** MM-042 (MTG Card Scraper & Multi-Game Tool Refactor)
**Worktree:** `feature/don-card-scraper-sources`

---

## Description

DON!! cards (the resource/energy cards in One Piece TCG) are not included in any existing card API (OPTCG API, Ryan API, Limitless TCG, etc.). They exist in a data gap: the official site maintains them only in a separate 39 MB PDF, and retailers like TCGPlayer list them but without a public API. This task adds two new scraper adapters to source all 200+ DON!! card face variants, including standard, alternate art, manga, gold, promo, SDS, and tournament-exclusive DON!! cards.

## Dependencies

- **MM-042** (Complete) — MTG Card Scraper & Multi-Game Tool Refactor. Established the multi-game adapter architecture that this task extends.

## Background: The DON!! Card Data Gap

- **Official card list** (`en.onepiece-cardgame.com/cardlist/`) does NOT include DON!! cards
- **Official DON!! Card List PDF** (`asia-en.onepiece-cardgame.com/pdf/don-cardlist.pdf`) — 39 MB, updated regularly, contains all DON!! variants with images
- **No existing API** includes DON!! cards (OPTCG API, Ryan API, Limitless, Vegapull)
- **TCGPlayer** lists 211+ DON!! variants with `CardType=DON!!` filter, but requires JS rendering
- **DON!! cards have no official card numbers** — they use "NNO" (No Number) designation

### DON!! Card Variant Types

| Variant | Description | Count (approx) |
|---------|-------------|-----------------|
| Standard | Base DON!! per booster set (OP01–OP14) | ~14 |
| Alternate Art | Special art variant per set | ~14 |
| Manga | Manga-style artwork | ~5 |
| PRB Character DON | Character-themed (PRB-01: 30, PRB-02: 30) | ~60 |
| Gold DON | Gold-framed (PRB-02 God Packs) | ~10 |
| SDS | Special DON!! Sets (SDS-01, SDS-02, SDS-03) | ~3 |
| Promo/Tournament | Championship, Red Bull, ONE PIECE DAY | ~10+ |
| Foil variants | Various foil treatments | varies |

### ID Format

DON!! cards use the `DON-{SET}` naming convention since they have no official card numbers:

```
DON-OP01          # Standard DON from OP01
DON-OP01-ALT      # Alternate art from OP01
DON-OP01-MANGA    # Manga variant from OP01
DON-PRB01-01      # First character DON from PRB-01
DON-PRB02-GOLD-01 # Gold DON from PRB-02
DON-SDS01         # Special DON!! Set 01
DON-PROMO-01      # Promo/tournament DON
```

## User Stories

### US-MM-048.1: PDF Adapter — Parse Official DON!! Card List

As a card scraper operator, I want to extract DON!! card images and metadata from the official DON!! Card List PDF so that I have the most authoritative and complete source.

**Acceptance Criteria:**
- [ ] New adapter file: `card_scraper/games/onepiece/adapters/don_pdf_adapter.py`
- [ ] Downloads the official PDF from `asia-en.onepiece-cardgame.com/pdf/don-cardlist.pdf`
- [ ] Extracts individual card images from PDF pages (each page contains card face images)
- [ ] Parses card metadata (set, variant type) from PDF text/layout
- [ ] Generates `OnePieceCardData` objects with `card_type="don"`
- [ ] Assigns IDs using the `DON-{SET}` convention
- [ ] Handles PDF updates gracefully (cached download, version check via URL params)
- [ ] Adapter registered in `_ADAPTER_REGISTRY` under `onepiece` with key `"don-pdf"`
- [ ] Rate limiting not required (single file download)
- [ ] Unit tests with mocked PDF content (using `respx` or file fixtures)

### US-MM-048.2: TCGPlayer Adapter — Scrape DON!! Card Listings

As a card scraper operator, I want to scrape DON!! card images from TCGPlayer so that I have a secondary source with the widest variant coverage.

**Acceptance Criteria:**
- [ ] New adapter file: `card_scraper/games/onepiece/adapters/don_tcgplayer_adapter.py`
- [ ] Uses Playwright for JS-rendered page scraping
- [ ] Navigates to TCGPlayer's One Piece card search with `CardType=DON!!` filter
- [ ] Extracts card images, names, and set information from search results
- [ ] Paginates through all results (211+ variants)
- [ ] Generates `OnePieceCardData` objects with `card_type="don"` and appropriate IDs
- [ ] Handles rate limiting (respectful delay between page loads)
- [ ] Graceful error handling if TCGPlayer layout changes (structured selectors with fallbacks)
- [ ] Playwright added as an optional dependency in `pyproject.toml` (extras group)
- [ ] Adapter registered in `_ADAPTER_REGISTRY` under `onepiece` with key `"don-tcgplayer"`
- [ ] Unit tests with mocked Playwright responses

### US-MM-048.3: Manifest & Pipeline Integration

As a card scraper operator, I want DON!! cards included in the One Piece manifest and download pipeline so that the frontend can load DON!! card faces.

**Acceptance Criteria:**
- [ ] `manifest_template.py` handles `card_type="don"` entries correctly
- [ ] DON!! cards appear in set manifests under their respective sets
- [ ] DON!! cards without a clear set association grouped under a `DON` or `PROMO` set
- [ ] Image downloader saves DON!! card images with correct filenames (`DON-OP01.jpg`, etc.)
- [ ] `config.yaml` updated with new adapter entries (disabled by default, priority 4 and 5)
- [ ] CLI `--sets` flag supports `DON` as a set filter for DON-only scraping
- [ ] State tracker handles DON!! card download state correctly

### US-MM-048.4: Configuration & Documentation

As a developer, I want clear configuration and documentation for the DON!! adapters so that operators can enable and use them.

**Acceptance Criteria:**
- [ ] `config.example.yaml` includes DON!! adapter configuration with comments
- [ ] `README.md` updated with DON!! card scraping instructions
- [ ] Playwright installation instructions documented (`playwright install chromium`)
- [ ] Example CLI commands for DON-only scraping

## Technical Details

### Architecture

```
card_scraper/games/onepiece/adapters/
├── optcg_api.py           # Existing (Character, Leader, Event, Stage)
├── ryan_api.py            # Existing (fallback)
├── vegapull_records.py    # Existing (local fallback)
├── don_pdf_adapter.py     # NEW — Official PDF source
└── don_tcgplayer_adapter.py # NEW — TCGPlayer JS scraper
```

### PDF Parsing Strategy

The official DON!! Card List PDF contains card images arranged in a grid layout. Approach:

1. Download PDF (cache locally, use URL version param for freshness)
2. Use `pymupdf` (fitz) or `pdfplumber` to extract embedded images
3. Use OCR or text extraction for card metadata (set name, variant type)
4. Map extracted images to `DON-{SET}` IDs based on page/position context
5. Return as `OnePieceCardData` list

**Library options:**
- `pymupdf` (fitz) — fast, good image extraction, BSD license
- `pdfplumber` — good text extraction, can pair with pymupdf for images
- `camelot-py` — table extraction (if PDF has tabular layout)

### TCGPlayer Scraping Strategy

1. Launch Playwright browser (headless Chromium)
2. Navigate to: `https://www.tcgplayer.com/search/one-piece-card-game/product?CardType=DON!!&view=grid`
3. Wait for card grid to render
4. For each card tile: extract image URL, name, set info
5. Paginate (click "Next" or scroll) until all results loaded
6. Download high-res images from extracted URLs
7. Map to `DON-{SET}` IDs based on parsed card names

### Adapter Priority Chain (Updated)

```yaml
sources:
  - name: optcg-api       # priority 1 — main cards
  - name: ryan-api         # priority 2 — fallback
  - name: vegapull-records # priority 3 — local fallback
  - name: don-pdf          # priority 4 — DON!! from official PDF
  - name: don-tcgplayer    # priority 5 — DON!! from TCGPlayer
```

DON!! adapters only return `card_type="don"` cards, so they complement (not compete with) the main card adapters.

### Dependencies to Add

```toml
# pyproject.toml
[project.optional-dependencies]
pdf = ["pymupdf>=1.24"]
browser = ["playwright>=1.40"]
all = ["pymupdf>=1.24", "playwright>=1.40"]
```

## Files to Create/Modify

**New Files:**
- `card_scraper/games/onepiece/adapters/don_pdf_adapter.py` — Official PDF parser adapter
- `card_scraper/games/onepiece/adapters/don_tcgplayer_adapter.py` — TCGPlayer Playwright scraper
- `tests/onepiece/test_don_pdf_adapter.py` — PDF adapter tests
- `tests/onepiece/test_don_tcgplayer_adapter.py` — TCGPlayer adapter tests
- `tests/onepiece/fixtures/don_sample.pdf` — Small fixture PDF for testing

**Modified Files:**
- `card_scraper/adapters.py` — Register new adapters in `_ADAPTER_REGISTRY`
- `card_scraper/games/onepiece/manifest_template.py` — Handle `card_type="don"` entries
- `config.yaml` — Add DON!! adapter entries
- `config.example.yaml` — Document DON!! adapter configuration
- `pyproject.toml` — Add `pymupdf` and `playwright` as optional dependencies
- `README.md` — DON!! scraping documentation

**Tests:**
- `tests/onepiece/test_don_pdf_adapter.py` — PDF parsing, image extraction, ID generation
- `tests/onepiece/test_don_tcgplayer_adapter.py` — Page scraping, pagination, ID mapping

## Inventory Check

Before starting, verify:
- [ ] Existing scraper runs successfully (`python -m card_scraper --game onepiece status`)
- [ ] `pymupdf` can be installed in the project environment
- [ ] `playwright` can be installed and `playwright install chromium` succeeds
- [ ] Official DON!! PDF URL is accessible: `https://asia-en.onepiece-cardgame.com/pdf/don-cardlist.pdf`
- [ ] TCGPlayer DON!! search page loads: `https://www.tcgplayer.com/search/one-piece-card-game/product?CardType=DON!!`

## Completion Criteria

- [ ] Both adapters implemented and registered
- [ ] PDF adapter extracts DON!! card images and generates valid OnePieceCardData
- [ ] TCGPlayer adapter scrapes DON!! listings and generates valid OnePieceCardData
- [ ] DON!! cards appear in generated manifests with `card_type="don"`
- [ ] Image downloader saves DON!! card images correctly
- [ ] All tests pass
- [ ] Configuration documented
- [ ] `DON-{SET}` ID convention consistently applied

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
