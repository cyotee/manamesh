# Magic: The Gathering Card Data Sources Research

**Task:** MM-041
**Date:** 2026-02-08
**Purpose:** Evaluate data sources for building ManaMesh MTG asset packs and extending the existing scraper tool

## Executive Summary

After evaluating 4 data sources for Magic: The Gathering card data, **Scryfall API** is the recommended primary (and likely sole) source due to its:
- Free, unauthenticated access with generous rate limits (10 req/s)
- Comprehensive data: every MTG card ever printed, all fields, all languages
- High-resolution card images in 6 size variants (PNG, large, normal, small, border_crop, art_crop)
- Excellent multi-face card support (card_faces array with per-face images)
- Daily bulk data downloads (avoiding API rate limits entirely)
- Full coverage of MTGCard schema fields required by MM-024

**Secondary recommendation:** Use **MTGJSON** as a data verification/enrichment source (provides identifiers, legalities, and foreign data not in Scryfall).

**Not recommended:** MTG GraphQL API (outdated, limited) and Gatherer (no API, hard to scrape).

---

## Sources Evaluated

| Source | Type | Auth Required | Rate Limit | Image Access | Card Count | Recommended |
|--------|------|---------------|------------|--------------|------------|-------------|
| Scryfall | REST API + Bulk | No | 10 req/s | 6 sizes, high-res PNG | ~95,000+ unique | **Primary** |
| MTGJSON | Bulk JSON/SQL | No | N/A (download) | None | ~95,000+ unique | **Secondary (data only)** |
| MTG GraphQL | REST API | No | 5000 req/hr | Via Gatherer URLs | Incomplete | Not recommended |
| Gatherer | Web scrape | N/A | Unknown | HTML scrape only | Complete | Not recommended |

---

## Detailed Source Analysis

### 1. Scryfall API -- RECOMMENDED

**URL:** https://scryfall.com/docs/api
**Base URL:** `https://api.scryfall.com`

**Overview:**
Scryfall is the gold standard for MTG data. Free, no authentication, comprehensive card data with high-resolution images. Provides both a REST API (for individual lookups) and daily bulk data downloads (for full database imports).

**Coverage:**
- Every MTG card ever printed in every language
- All 23 set types: core, expansion, masters, commander, promo, token, etc.
- Multi-face cards (transform, modal DFC, split, flip, meld, adventure)
- Tokens, emblems, planes, schemes, and funny (Un-set) cards
- Daily price data from multiple markets

**Key Endpoints:**
```
Cards:
  GET /cards/search?q={query}        - Advanced search with Scryfall syntax
  GET /cards/named?exact={name}      - Exact name lookup
  GET /cards/{code}/{number}         - By set code + collector number
  GET /cards/{id}                    - By Scryfall UUID
  GET /cards/collection             - Batch lookup (up to 75 cards)
  GET /cards/random                 - Random card

Sets:
  GET /sets                          - List all sets
  GET /sets/{code}                  - Specific set by code

Bulk Data:
  GET /bulk-data                     - List available bulk downloads
  GET /bulk-data/{type}             - Specific bulk file metadata

Other:
  GET /cards/{id}/rulings           - Card rulings
  GET /symbology                     - Mana symbols
  GET /catalog/{name}               - Data catalogs
```

**Rate Limits:**
- API: 50-100ms between requests (~10 req/s)
- Bulk data: No rate limit (download once daily)
- Image CDN (`cards.scryfall.io`): No rate limit
- Exceeding: HTTP 429, potential temporary/permanent ban

**Bulk Data Files (updated daily):**

| File | Size | Content |
|------|------|---------|
| Oracle Cards | 161 MB | One entry per unique card (latest printing) |
| Unique Artwork | 233 MB | One entry per unique artwork |
| Default Cards | 501 MB | Every English printing |
| All Cards | 2.3 GB | Every printing in every language |
| Rulings | 23.4 MB | All card rulings |

**Image Sizes:**

| Format | Dimensions | Type | Use Case |
|--------|-----------|------|----------|
| PNG | 745x1040 | PNG (transparent) | Best quality, video/print |
| Large | 672x936 | JPG | Full-size display |
| Normal | 488x680 | JPG | Standard card display |
| Small | 146x204 | JPG | Thumbnails, lists |
| Border Crop | 480x680 | JPG | No rounded corners/borders |
| Art Crop | Variable | JPG | Art only, no card frame |

**Image Status Field:**
- `highres_scan` - Full quality scanner image
- `lowres` - Recently spoiled, lower quality
- `placeholder` - No official image yet
- `missing` - No image at all

**Multi-Face Card Handling:**
- `card_faces` array with per-face data (name, mana_cost, oracle_text, image_uris, etc.)
- Each face has its own `image_uris` for all 6 sizes
- Layout types: `transform`, `modal_dfc`, `split`, `flip`, `meld`, `adventure`, `reversible_card`

**Terms of Service:**
- Free to use for community tools
- Must not paywall Scryfall data
- Must not imply Scryfall endorsement
- Must not just repackage data (must add value)
- Card images: do not crop/clip copyright or artist name
- Art crops: must credit artist elsewhere

**Strengths:**
- Single source covers ALL requirements (data + images)
- Bulk download eliminates API rate limit concerns
- Multi-face card handling is excellent
- image_uris provides pre-built URLs for all sizes
- Daily updates, sometimes same-day for new sets

**Weaknesses:**
- Image terms require attribution (not onerous)
- Bulk files are large (501 MB for Default Cards)
- Power/toughness are strings (can be `*`, `1+*`, etc.) not numbers

---

### 2. MTGJSON -- SECONDARY (Data Enrichment)

**URL:** https://mtgjson.com/
**Access:** Direct file download (no API for free tier)

**Overview:**
Open-source project providing comprehensive MTG metadata as downloadable JSON, SQL, SQLite, and CSV files. Updated daily. No card images, but excellent for data cross-referencing, identifiers, and fields Scryfall might not have.

**Coverage:**
- Every MTG card in every printing
- All sets, including supplemental products
- Foreign language card data
- Price data (90-day history)
- Sealed product and booster information
- Complete keyword and card type catalogs

**Available Download Files:**

| File | Format | Content |
|------|--------|---------|
| AllPrintings | JSON, SQL, SQLite, PSQL | All sets with complete card data |
| AtomicCards | JSON | Unique cards by name |
| AllIdentifiers | JSON | All cards by UUID |
| AllPrices | JSON | 90-day price history |
| AllPricesToday | JSON | Current-day prices |
| SetList | JSON | Set metadata listing |
| DeckList | JSON | Pre-constructed deck data |
| Keywords | JSON | All keywords |
| CardTypes | JSON | All card types |
| Format-specific | JSON | Standard, Modern, Legacy, Pioneer, Vintage, Pauper |

**Card Fields (Required):**
- `name`, `uuid`, `type`, `types`, `subtypes`, `supertypes`
- `manaValue` (number), `colors`, `colorIdentity`
- `availability`, `finishes`, `borderColor`, `frameVersion`
- `identifiers` (cross-reference IDs for Scryfall, Gatherer, MTGO, Arena, TCGplayer, Cardmarket)
- `legalities` (all format legalities)
- `purchaseUrls`, `rarity`, `setCode`, `language`

**Card Fields (Optional, 70+ fields):**
- `manaCost` (string), `loyalty`, `power`, `toughness`, `defense`
- `text` (oracle text), `flavorText`, `artist`
- `keywords`, `rulings`, `foreignData`
- Boolean flags: `isReprint`, `isReserved`, `isPromo`, `isFoilOnly`, etc.

**Strengths:**
- SQLite format allows offline SQL queries
- Cross-reference identifiers (Scryfall UUID, Gatherer ID, MTGO ID, Arena ID, TCGplayer ID)
- Foreign language data comprehensive
- Sealed product and booster data (unique to MTGJSON)
- CSV/Parquet formats for analytics

**Weaknesses:**
- **No card images** (data only)
- GraphQL API requires Patreon subscription
- Download files are large
- Field names differ from Scryfall (e.g., `manaValue` vs `cmc`)

---

### 3. MTG GraphQL API (magicthegathering.io) -- NOT RECOMMENDED

**URL:** https://docs.magicthegathering.io/
**Base URL:** `https://api.magicthegathering.io/v1/`

**Overview:**
Older community-maintained REST API. No authentication required but lower rate limits and less comprehensive than Scryfall.

**Coverage:**
- Large card collection but **not guaranteed complete** for recent sets
- Less frequently updated than Scryfall
- Community-maintained, update lag after new releases

**Key Endpoints:**
```
GET /cards              - List cards (paginated, max 100/page)
GET /cards/:id          - Card by Multiverse ID
GET /sets               - List all sets
GET /sets/:code         - Set by code
GET /sets/:code/booster - Generate random booster
GET /types              - All card types
GET /subtypes           - All subtypes
GET /supertypes         - All supertypes
GET /formats            - All formats
```

**Rate Limits:**
- 5,000 requests per hour
- HTTP 403 on exceeding

**Card Fields Available:**
- `name`, `manaCost`, `cmc`, `colors`, `colorIdentity`
- `type`, `supertypes`, `types`, `subtypes`
- `rarity`, `set`, `setName`, `text`, `flavor`, `artist`
- `number`, `power`, `toughness`, `loyalty`
- `multiverseid`, `imageUrl`, `legalities`
- `foreignNames`, `printings`, `originalText`

**Image Access:**
- `imageUrl` field links to Gatherer images
- Only available for cards with `multiverseid`
- Quality: standard Gatherer resolution

**Strengths:**
- No authentication required
- Familiar REST patterns
- SDKs available (Python, JS, etc.)

**Weaknesses:**
- **Incomplete for newer sets** (update lag)
- Lower rate limit (5,000/hr vs Scryfall's ~36,000/hr)
- Images depend on Gatherer (indirect, lower quality)
- **No bulk download** option
- No multi-face card image support
- Less active maintenance

---

### 4. Gatherer (Official Wizards of the Coast) -- NOT RECOMMENDED

**URL:** https://gatherer.wizards.com/

**Overview:**
The official WotC card database. Authoritative for card text and rulings, but offers no public API and is difficult to scrape programmatically.

**Coverage:**
- Complete (authoritative source)
- All sets, all cards, all rulings
- Multi-language support

**Access Method:**
- **No public API**
- Web scraping required (HTML parsing)
- Search forms with POST requests
- Card images served via CDN (Contentful)

**Card Data Available (via HTML scraping):**
- Card name, mana cost, mana value
- Power, toughness, loyalty
- Oracle text, printed text
- Types, supertypes, subtypes
- Artist, flavor text
- Set, rarity, format legalities
- Rulings with dates

**Image Access:**
- Card images available but require scraping img tags
- Served via Contentful CDN
- Resolution: standard quality
- Multi-face images available

**Strengths:**
- **Authoritative** source of truth for card text
- Complete coverage
- Official rulings

**Weaknesses:**
- **No API** - requires HTML scraping
- Scraping may violate ToS (no explicit scraping policy but "official" site)
- Fragile - HTML structure can change without notice
- Slow - each card requires a page load
- No bulk download
- Image URLs unpredictable
- Modern browsers/JS rendering may be required

---

## Field Mapping: Sources to MTGCard Schema

### MTGCard Schema (from MM-024)

```typescript
interface MTGCard extends CoreCard {
  manaCost?: string;           // "{2}{W}{U}"
  cmc: number;
  types: string[];             // ['Creature', 'Artifact']
  subtypes?: string[];         // ['Elf', 'Warrior']
  supertypes?: string[];       // ['Legendary', 'Snow']
  power?: number;
  toughness?: number;
  loyalty?: number;
  oracleText?: string;
  set: string;
  collectorNumber: string;
  colors: ('W' | 'U' | 'B' | 'R' | 'G')[];
  colorIdentity: ('W' | 'U' | 'B' | 'R' | 'G')[];
}
```

**NOTE:** Scryfall and MTGJSON return `power` and `toughness` as **strings** (they can be `*`, `1+*`, `X`, etc.). The MTGCard schema defines them as `number`. The adapter should parse numeric values and store `null` for non-numeric (or store as strings and update the schema).

### Field Mapping Table

| MTGCard Field | Scryfall | MTGJSON | MTG GraphQL | Gatherer |
|---------------|----------|---------|-------------|----------|
| `id` (CoreCard) | `id` (UUID) | `uuid` | `multiverseid` | Multiverse ID |
| `name` (CoreCard) | `name` | `name` | `name` | Card name |
| `manaCost` | `mana_cost` | `manaCost` | `manaCost` | Mana cost |
| `cmc` | `cmc` | `manaValue` | `cmc` | Mana value |
| `types` | parse `type_line` | `types` | `types` | parse type line |
| `subtypes` | parse `type_line` | `subtypes` | `subtypes` | parse type line |
| `supertypes` | parse `type_line` | `supertypes` | `supertypes` | parse type line |
| `power` | `power` (string) | `power` (string) | `power` (string) | Power |
| `toughness` | `toughness` (string) | `toughness` (string) | `toughness` (string) | Toughness |
| `loyalty` | `loyalty` (string) | `loyalty` (string) | `loyalty` (string) | Loyalty |
| `oracleText` | `oracle_text` | `text` | `text` | Oracle text |
| `set` | `set` | `setCode` | `set` | Set code |
| `collectorNumber` | `collector_number` | `number` | `number` | Collector # |
| `colors` | `colors` | `colors` | `colors` | Colors |
| `colorIdentity` | `color_identity` | `colorIdentity` | `colorIdentity` | Color identity |
| `imageUrl` | `image_uris.normal` | N/A | `imageUrl` | HTML scrape |

**Parsing Notes:**
- Scryfall `type_line`: `"Legendary Creature - Elf Warrior"` -> supertypes: `['Legendary']`, types: `['Creature']`, subtypes: `['Elf', 'Warrior']`
- Scryfall `colors`: Array like `["W", "U"]` (already in correct format)
- MTGJSON `colors`: Array like `["W", "U"]` (same format)
- Multi-face cards: Scryfall `name` = `"Front // Back"`, individual face data in `card_faces[]`

### Coverage Comparison

| Feature | Scryfall | MTGJSON | MTG GraphQL | Gatherer |
|---------|----------|---------|-------------|----------|
| All MTGCard fields | Yes | Yes | Yes (most) | Yes |
| Multi-face cards | Excellent | Excellent | Partial | Yes |
| Images | 6 sizes | None | Via Gatherer | Scrape |
| High-res images | Yes (745x1040 PNG) | No | No | Limited |
| Token cards | Yes | Yes | Partial | Yes |
| Promo cards | Yes | Yes | Partial | Yes |
| Commander products | Yes | Yes | Partial | Yes |
| Secret Lair | Yes | Yes | Unlikely | Yes |
| Format legalities | Yes | Yes | Yes | Yes |
| Foreign languages | Yes (via bulk) | Yes | Yes | Partial |
| Daily updates | Yes | Yes | No (lag) | Yes |

---

## Image Source Evaluation

### Scryfall Images (Recommended)

| Size | Dimensions | Format | Quality | Use Case |
|------|-----------|--------|---------|----------|
| PNG | 745x1040 | PNG (transparent bg) | Best | Print, video, archival |
| Large | 672x936 | JPG | High | Full-size card display |
| Normal | 488x680 | JPG | Good | Standard card view |
| Small | 146x204 | JPG | Low | Thumbnails, search results |
| Border Crop | 480x680 | JPG | High | No rounded corners |
| Art Crop | Variable | JPG | High | Art only, no card frame |

**Multi-face card images:** Each face in `card_faces[]` has its own `image_uris` object with all 6 sizes.

**Image CDN:** `cards.scryfall.io` - no rate limit on image downloads.

**Image Policies:**
- Do not crop copyright/artist name
- Do not distort, blur, or watermark
- Art crops: credit artist elsewhere in UI

**Recommendation for ManaMesh asset packs:** Use **Normal** (488x680) for in-game display and **Small** (146x204) for deck builder thumbnails. Download **Large** (672x936) for zoom/preview.

### Estimated Download Sizes

| Scope | Card Count | Normal JPG | Large JPG | PNG |
|-------|-----------|------------|-----------|-----|
| Standard legal (~8 sets) | ~2,400 | ~240 MB | ~480 MB | ~1.2 GB |
| Modern legal (~60 sets) | ~18,000 | ~1.8 GB | ~3.6 GB | ~9 GB |
| All unique artwork | ~40,000 | ~4 GB | ~8 GB | ~20 GB |
| All printings | ~95,000+ | ~9.5 GB | ~19 GB | ~47 GB |

**Recommendation:** Start with Standard or a curated set list. Provide config option for which sets to scrape.

---

## Asset Pack Manifest Design for MTG

### Card ID Strategy

Use Scryfall's `{set_code}/{collector_number}` as the canonical card ID:
- Example: `MKM/001` (Murders at Karlov Manor, card 1)
- Unique per printing (unlike oracle_id which groups reprints)
- Maps directly to Scryfall API lookup: `GET /cards/{set}/{number}`

For file naming, normalize: `MKM-001` (replace `/` with `-`)

### Multi-Face Card Handling

Multi-face cards get **separate image files** per face but a **single manifest entry** with nested face data:

```json
{
  "id": "MKM-123",
  "name": "Delney, Streetwise Lookout // Delney, Street Swindler",
  "front": "cards/MKM-123-front.jpg",
  "back": "cards/MKM-123-back.jpg",
  "layout": "transform",
  "metadata": {
    "faces": [
      {
        "name": "Delney, Streetwise Lookout",
        "manaCost": "{2}{W}",
        "types": ["Legendary", "Creature"],
        "subtypes": ["Human", "Scout"],
        "power": 2,
        "toughness": 2,
        "text": "..."
      },
      {
        "name": "Delney, Street Swindler",
        "manaCost": "",
        "types": ["Legendary", "Creature"],
        "subtypes": ["Human", "Rogue"],
        "power": 3,
        "toughness": 3,
        "text": "..."
      }
    ]
  }
}
```

### Reprint Handling

Each printing is a separate manifest entry in its respective set directory. The `oracle_id` field (from Scryfall) can be used to group reprints if needed for deck building (find all printings of a card).

### Set Categories

| Scryfall set_type | ManaMesh Category | Include by Default |
|-------------------|-------------------|--------------------|
| `core` | core | Yes |
| `expansion` | expansion | Yes |
| `masters` | masters | Yes (if configured) |
| `commander` | commander | Yes (if configured) |
| `draft_innovation` | draft | Optional |
| `funny` | un-set | Optional |
| `starter` | starter | Optional |
| `promo` | promo | Optional |
| `token` | token | Optional |
| `memorabilia` | memorabilia | No |
| Other (12 types) | supplemental | Optional |

### Per-Set Manifest Structure

```json
{
  "name": "Magic: The Gathering - Murders at Karlov Manor",
  "version": "1.0.0",
  "game": "mtg",
  "cards": [
    {
      "id": "MKM-001",
      "name": "Aurelia, the Law Above",
      "front": "cards/MKM-001.jpg",
      "metadata": {
        "manaCost": "{2}{R}{W}",
        "cmc": 4,
        "types": ["Legendary", "Creature"],
        "subtypes": ["Angel"],
        "supertypes": [],
        "power": 4,
        "toughness": 4,
        "loyalty": null,
        "oracleText": "Flying, vigilance, haste...",
        "colors": ["R", "W"],
        "colorIdentity": ["R", "W"],
        "rarity": "mythic",
        "layout": "normal",
        "keywords": ["Flying", "Vigilance", "Haste"]
      }
    }
  ]
}
```

### Root Manifest Structure

```json
{
  "name": "Magic: The Gathering - Complete",
  "version": "1.0.0",
  "game": "mtg",
  "sets": [
    { "name": "Murders at Karlov Manor", "code": "MKM", "path": "MKM", "category": "expansion" },
    { "name": "The Lost Caverns of Ixalan", "code": "LCI", "path": "LCI", "category": "expansion" }
  ]
}
```

---

## Adapter Architecture Recommendation

### Tool Refactoring Plan

Rename `tools/onepiece-scraper/` to `tools/card-scraper/` with the following structure:

```
tools/card-scraper/
  pyproject.toml
  config.example.yaml
  README.md
  card_scraper/                      # Renamed from onepiece_scraper
    __init__.py
    __main__.py
    cli.py                           # Add --game flag
    config.py                        # Multi-game config support
    models.py                        # Game-agnostic base + game-specific extensions
    scraper.py                       # Core orchestrator (game-agnostic)
    downloader.py                    # Image downloader (shared)
    manifest.py                      # Manifest generator (game-specific templates)
    state.py                         # State tracker (shared)
    games/
      __init__.py
      onepiece/
        __init__.py
        adapters/
          optcg_api.py
          ryan_api.py
          vegapull_records.py
        models.py                    # OnePieceCardData(CardData)
        manifest_template.py
      mtg/
        __init__.py
        adapters/
          scryfall.py               # Primary: REST + bulk data
          mtgjson.py                # Secondary: data enrichment
        models.py                    # MTGCardData(CardData)
        manifest_template.py
        type_parser.py              # Parse type_line into types/subtypes/supertypes
```

### CardData Model Evolution

The current `CardData` is One Piece-specific (has `cost`, `power`, `counter`, `life` etc.). For multi-game support, introduce a base class with a `metadata` dict:

```python
@dataclass
class CardDataBase:
    """Game-agnostic card data."""
    id: str
    name: str
    image_url: str
    set_id: str
    source: str
    rarity: str
    metadata: dict[str, Any]  # Game-specific fields

@dataclass
class MTGCardData(CardDataBase):
    """MTG-specific card data with typed fields."""
    mana_cost: str | None = None
    cmc: float = 0
    types: list[str] = field(default_factory=list)
    subtypes: list[str] = field(default_factory=list)
    supertypes: list[str] = field(default_factory=list)
    power: str | None = None
    toughness: str | None = None
    loyalty: str | None = None
    oracle_text: str = ""
    colors: list[str] = field(default_factory=list)
    color_identity: list[str] = field(default_factory=list)
    layout: str = "normal"
    card_faces: list[dict] | None = None  # Multi-face data
    keywords: list[str] = field(default_factory=list)
```

### Multi-Game Config Structure

```yaml
game: mtg  # or "onepiece"

sources:
  mtg:
    - name: scryfall
      enabled: true
      priority: 1
      rate_limit_ms: 100
      use_bulk: true           # Download bulk JSON instead of per-card API calls
      image_size: normal       # small, normal, large, png
    - name: mtgjson
      enabled: true
      priority: 2
      local_path: ./data/mtgjson/  # Downloaded AllPrintings.json

  onepiece:
    - name: optcg-api
      enabled: true
      priority: 1
      rate_limit_ms: 200

output:
  base_dir: ./output/
  manifest_version: "1.0"

scrape:
  sets: all                    # or list: [MKM, LCI, WOE]
  categories: [core, expansion, commander]  # Filter by set_type
  include_tokens: false

state:
  state_file: ./state/scrape-state.json
```

### Scryfall Adapter Strategy

For efficiency, the Scryfall adapter should support two modes:

1. **Bulk mode (recommended):** Download `Default Cards` JSON (~501 MB), parse locally, extract per-set data. No API rate limits. One download per day.
2. **API mode:** Query `/cards/search` for specific sets. Slower but lower disk usage. Use for targeted updates.

Image downloads happen separately via the CDN (no rate limit).

### Estimated Implementation Effort

| Component | Effort | Notes |
|-----------|--------|-------|
| Refactor tool to multi-game | 2-3 hours | Rename, restructure, extract base classes |
| Scryfall adapter (bulk mode) | 3-4 hours | JSON parsing, type_line parser, image URL extraction |
| Scryfall adapter (API mode) | 2-3 hours | REST client, pagination, search queries |
| MTGJSON adapter | 2-3 hours | JSON parsing, field mapping |
| MTG manifest templates | 1-2 hours | Multi-face handling, set categorization |
| MTG-specific models | 1-2 hours | MTGCardData, type parser |
| Tests | 3-4 hours | Mocked responses, manifest validation |
| **Total** | **~14-21 hours** | |

---

## Recommendation Summary

### Ranked Source Recommendation

| Rank | Source | Role | Justification |
|------|--------|------|---------------|
| 1 | **Scryfall** | Primary (data + images) | Most comprehensive, best images, bulk download, free, well-maintained |
| 2 | **MTGJSON** | Secondary (data enrichment) | Cross-reference IDs, foreign data, SQLite for offline queries, sealed product data |
| 3 | MTG GraphQL | Not recommended | Outdated, incomplete, slower, images via Gatherer |
| 4 | Gatherer | Not recommended | No API, scraping fragile, all data available via Scryfall |

### Key Design Decisions for Implementation

1. **Use Scryfall bulk data** as primary source (avoids rate limits, gets everything)
2. **Download `Default Cards`** file (English, all printings, 501 MB)
3. **Use `Normal` size images** (488x680) for asset packs, with config option for other sizes
4. **Power/toughness as strings** in the adapter model (handle `*`, `X`, etc.), convert to number where possible for the MTGCard frontend type
5. **Multi-face cards**: store both face images, single manifest entry with `card_faces` array
6. **Reprints**: each printing is a separate entry in its set directory (users pick which art they want)
7. **Set filtering**: default to Standard-legal sets, configurable via YAML

### Risks & Blockers

- **Scryfall ToS**: must add value, not just repackage. ManaMesh's P2P card gaming platform clearly adds value.
- **Image attribution**: need to preserve artist credit. Card images already include artist name on the card face.
- **Disk space**: full MTG collection with Normal images is ~9.5 GB. Need set filtering in config.
- **Type line parsing**: Scryfall doesn't provide separate types/subtypes/supertypes arrays (returns `type_line` string). Need a parser. Pattern: `"{Supertypes} {Types} - {Subtypes}"` with `-` as delimiter.

---

## Appendix: Sample Scryfall Card Response

```json
{
  "id": "9a9a2a2d-6a10-4d29-bb2d-3e1a8db9b0e5",
  "oracle_id": "fa7b83c3-2a40-49cc-bd66-1f4a0b0e8e84",
  "name": "Lightning Bolt",
  "lang": "en",
  "layout": "normal",
  "mana_cost": "{R}",
  "cmc": 1.0,
  "type_line": "Instant",
  "oracle_text": "Lightning Bolt deals 3 damage to any target.",
  "colors": ["R"],
  "color_identity": ["R"],
  "keywords": [],
  "legalities": {
    "standard": "not_legal",
    "modern": "legal",
    "legacy": "legal",
    "vintage": "restricted",
    "commander": "legal",
    "pauper": "legal"
  },
  "set": "m11",
  "set_name": "Magic 2011",
  "collector_number": "149",
  "rarity": "common",
  "artist": "Christopher Moeller",
  "power": null,
  "toughness": null,
  "loyalty": null,
  "image_uris": {
    "small": "https://cards.scryfall.io/small/front/9/a/9a9a2a2d.jpg",
    "normal": "https://cards.scryfall.io/normal/front/9/a/9a9a2a2d.jpg",
    "large": "https://cards.scryfall.io/large/front/9/a/9a9a2a2d.jpg",
    "png": "https://cards.scryfall.io/png/front/9/a/9a9a2a2d.png",
    "art_crop": "https://cards.scryfall.io/art_crop/front/9/a/9a9a2a2d.jpg",
    "border_crop": "https://cards.scryfall.io/border_crop/front/9/a/9a9a2a2d.jpg"
  },
  "image_status": "highres_scan",
  "prices": {
    "usd": "1.25",
    "usd_foil": "3.50"
  }
}
```
