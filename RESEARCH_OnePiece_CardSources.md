# One Piece TCG Card Data Sources Research

**Task:** MM-033
**Date:** 2026-01-31
**Purpose:** Evaluate data sources for building ManaMesh One Piece TCG asset packs

## Executive Summary

After evaluating 7 distinct sources for One Piece TCG card data, **OPTCG API (optcgapi.com)** is the recommended primary source due to its:
- Free, unauthenticated access
- Complete data coverage (OP-01 through OP-14, all starter decks, promos)
- Direct image URLs for high-quality card images
- Comprehensive card fields matching ManaMesh requirements
- Active maintenance with daily data updates

**Secondary recommendation:** Use **vegapull-records** as a backup/verification source for data integrity.

---

## Sources Evaluated

| Source | Type | Auth Required | Rate Limit | Image Access | Recommended |
|--------|------|---------------|------------|--------------|-------------|
| OPTCG API | REST API | No | Informal | Direct URLs | **Primary** |
| OPTCG API (ryanmichaelhirst) | REST API | No | Unknown | Yes | Tertiary |
| API TCG | REST API | **Yes (API Key)** | Unknown | Yes | Not recommended |
| Vegapull | CLI Scraper | No | N/A | Download | Tool only |
| Vegapull-records | Dataset | No | N/A | Archive | **Backup** |
| Limitless TCG | Web DB | N/A | N/A | None | Research only |
| onepiece-cardgame.dev | Web App | N/A | N/A | Unknown | Not viable |
| Official Site | Web | N/A | Prohibited | N/A | **Source of truth** |

---

## Detailed Source Analysis

### 1. OPTCG API (optcgapi.com) ⭐ RECOMMENDED

**URL:** https://optcgapi.com/

**Overview:**
Free, unauthenticated REST API providing comprehensive One Piece TCG card data with direct image URLs and pricing information.

**Coverage:**
- Sets: OP-01 through OP-14, EB-01, EB-02, PRB-01, PRB-02
- Starter Decks: All (separate endpoints)
- Promo Cards: Dedicated endpoint
- Total estimated cards: 2000+

**Endpoints:**
```
Base URL: https://optcgapi.com/api/

Sets:
  GET /allSets/              - List all set names and IDs
  GET /allSetCards/          - All cards from all sets
  GET /sets/{set_id}/        - Cards in specific set
  GET /sets/card/{card_id}/  - Specific card by ID
  GET /sets/filtered/        - Filtered search

Starter Decks:
  GET /allDecks/             - All starter deck info
  GET /allSTCards/           - All starter deck cards
  GET /decks/{st_id}/        - Cards in specific deck
  GET /decks/card/{card_id}/ - Specific starter card

Promos:
  GET /allPromoCards/        - All promotional cards
  GET /promos/filtered/      - Filtered promo search
  GET /promos/card/{card_id}/ - Specific promo card

Pricing History:
  GET /sets/card/twoweeks/{card_id}/   - 13-day price history
  GET /decks/card/twoweeks/{card_id}/  - Starter deck pricing
  GET /promos/card/twoweeks/{card_id}/ - Promo pricing
```

**Data Fields (per card):**
```json
{
  "card_name": "string",
  "card_text": "string",
  "card_type": "Character|Leader|Event|Stage",
  "card_color": "string",
  "rarity": "C|UC|R|SR|L|SEC",
  "attribute": "Special|Wisdom|Strike|Slash|Ranged",
  "card_cost": "number|null",
  "card_power": "number|null",
  "life": "number|null",
  "counter_amount": "number|null",
  "sub_types": "string (traits/affiliations)",
  "set_id": "string",
  "set_name": "string",
  "card_set_id": "string (unique identifier)",
  "inventory_price": "number",
  "market_price": "number",
  "date_scraped": "ISO date",
  "card_image_id": "string",
  "card_image": "URL"
}
```

**Image URL Pattern:**
```
https://optcgapi.com/media/static/Card_Images/{card_image_id}.jpg
```

**Filter Parameters:**
- card_name, color, set_id, set_name, rarity, card_type
- card_cost, card_power, attribute, card_image_id

**Authentication:** None required

**Rate Limiting:** Informal ("please try not to do an insane amount of API calls each day")

**Pros:**
- Completely free with no authentication
- Comprehensive data coverage
- Direct image URLs (no scraping needed)
- Includes pricing data
- Daily updates (date_scraped field)
- Well-documented endpoints

**Cons:**
- Informal rate limiting may become strict
- Single point of failure (one maintainer)
- English cards only

**Sample Response:**
```json
{
  "inventory_price": 0.75,
  "market_price": 0.89,
  "card_name": "Perona",
  "set_name": "Romance Dawn",
  "card_text": "[On Play] Look at 5 cards from the top...",
  "set_id": "OP-01",
  "rarity": "UC",
  "card_set_id": "OP01-077",
  "card_color": "Blue",
  "card_type": "Character",
  "life": null,
  "card_cost": "1",
  "card_power": "2000",
  "sub_types": "Thriller Bark Pirates",
  "counter_amount": 1000,
  "attribute": "Special",
  "date_scraped": "2026-01-31",
  "card_image_id": "OP01-077",
  "card_image": "https://optcgapi.com/media/static/Card_Images/OP01-077.jpg"
}
```

---

### 2. OPTCG API (ryanmichaelhirst) - Alternative

**URL:** https://optcg-api.ryanmichaelhirst.us/

**Overview:**
Open-source alternative API with similar functionality, useful as failover.

**Base URL:** `https://optcg-api.ryanmichaelhirst.us/api/v1`

**Endpoints:**
```
GET /cards              - List cards with pagination
GET /cards/{id}         - Get specific card
```

**Query Parameters:**
- page, per_page (pagination)
- search (card name)
- color, set, type, cost, class, counter, power, rarity (filters)

**Data Fields:**
```
id, code, rarity, type, name, cost, attribute, power,
counter, color, class, effect, set, image
```

**Pros:**
- Open source
- No authentication
- Clean API design

**Cons:**
- Less comprehensive documentation
- Unknown maintenance status
- Fewer fields than primary OPTCG API

---

### 3. API TCG (apitcg.com) - NOT RECOMMENDED

**URL:** https://apitcg.com/

**Overview:**
Multi-TCG API supporting One Piece, Pokemon, Digimon, Dragon Ball Fusion, Magic, Gundam, and more.

**Authentication:** **Required** - Must register at https://apitcg.com/platform for API key

**Endpoints:**
```
Base URL: https://apitcg.com/api/one-piece/

GET /cards              - List all cards
GET /cards?property=value - Filtered search
GET /cards/{id}         - Specific card
```

**Data Fields:**
```json
{
  "id": "string",
  "code": "string",
  "rarity": "C|UC|R|SR|L|SEC",
  "type": "CHARACTER|LEADER|EVENT|STAGE",
  "name": "string",
  "images": {"small": "url", "large": "url"},
  "cost": "number",
  "attribute": {"name": "string", "image": "url"},
  "power": "number",
  "counter": "number",
  "color": "string",
  "family": "string",
  "ability": "string",
  "trigger": "string",
  "set": {"name": "string"},
  "notes": []
}
```

**Pros:**
- Multi-TCG support
- Small and large image variants
- Active development

**Cons:**
- **Requires API key registration**
- Unknown rate limits
- Less documented than OPTCG API

---

### 4. Vegapull (Rust CLI Scraper)

**URL:** https://github.com/Coko7/vegapull

**Overview:**
Rust-based CLI tool that scrapes card data directly from the official One Piece TCG website.

**Installation:**
```bash
cargo install vegapull
```

**Commands:**
```bash
vega pull all                    # Interactive mode
vega pull packs                  # Get pack list
vega pull cards {pack_id}        # Get cards from pack
vega pull cards {id} --with-images  # Include image downloads
```

**Output Format:** JSON files organized by pack

**Current Version:** 1.2.0 (January 20, 2026) - Actively maintained

**Pros:**
- Direct official source
- Parallel download support
- Can download images
- Active development

**Cons:**
- Requires Rust toolchain
- Scraping = potential ToS violation
- No hosted API (must run locally)

**License:** GPL-3.0

---

### 5. Vegapull-records (Pre-scraped Dataset)

**URL:** https://github.com/Coko7/vegapull-records

**Overview:**
Pre-scraped dataset repository containing JSON card data and downloadable image archives.

**Data Structure:**
```
data/
├── english/
│   ├── packs.json
│   ├── cards_569001.json
│   ├── cards_569002.json
│   └── ... (per-pack JSON files)
└── japanese/
    └── cards.json
```

**Image Access:**
- Not in repo directly
- Available as downloadable archives in GitHub Releases
- Last release: April 27, 2025 (English)

**Known Issues:**
- "Wrong formatting/missing data for colors or counter values on some cards"
- Japanese version has data quality issues

**Pros:**
- No API calls needed
- Includes image archives
- Good for offline/backup

**Cons:**
- Static snapshot (not real-time)
- Some data quality issues
- Manual update process

**License:** GPL-3.0

---

### 6. Limitless TCG

**URL:** https://onepiece.limitlesstcg.com/cards

**Overview:**
Comprehensive web database with advanced search, primarily for competitive play and deck building.

**Coverage:**
- 14 booster packs (OP01-OP14, EB01-EB03, PRB01-PRB02)
- 29 starter decks (ST01-ST29)
- Promotional cards on separate page

**Features:**
- Advanced search with extensive filters
- Price tracking (TCGplayer, CardMarket)
- Multiple display modes
- Image Generator, Proxy Printer tools

**Filter Options:**
- Name, text, category, color, cost, life, power, counter
- Attribute, effect types, rarity, parallel versions
- Series, block, set, artist
- Price ranges (USD/EUR)

**API Access:** **None** - Web interface only

**Pros:**
- Most comprehensive filter options
- Excellent for research/verification
- Price tracking across markets

**Cons:**
- No programmatic access
- Would require scraping (ToS violation)
- Not suitable for asset pack building

---

### 7. onepiece-cardgame.dev

**URL:** https://onepiece-cardgame.dev/

**Overview:**
React-based web application requiring JavaScript execution.

**Assessment:**
- Rendered client-side only
- No visible API endpoints
- Protected by Cloudflare
- Cannot evaluate data without browser automation

**Recommendation:** Not viable for programmatic access

---

### 8. Official Site (en.onepiece-cardgame.com)

**URL:** https://en.onepiece-cardgame.com/cardlist/

**Overview:**
Official Bandai Namco One Piece TCG website.

**Important Legal Note:**
> "All images, text and data on this website may not be reproduced without permission."

**Technical Implementation:**
- JavaScript-based pagination
- Filter options for product, color, card type, illustration
- Modal-based card detail views
- Uses placeholder images with lazy loading

**Image URL Pattern:** `/images/cardlist/` base path

**Assessment:**
- **Source of truth** for card data accuracy
- **Explicitly prohibits scraping**
- No public API
- Best used for verification only

---

## Field Mapping to ManaMesh

### Required Fields (from PROMPT.md)

```typescript
interface OnePieceCardCore {
  id: string;              // → card_set_id (OPTCG) or id (API TCG)
  name: string;            // → card_name
  cardType: 'character' | 'leader' | 'event' | 'stage' | 'don';  // → card_type
  cost?: number;           // → card_cost
  power?: number;          // → card_power
  color: string[];         // → card_color (needs splitting for multi-color)
  imageUrl: string;        // → card_image
}
```

### OPTCG API → ManaMesh Mapping

```typescript
interface OptcgToManaMesh {
  // Direct mappings
  id: card.card_set_id,
  name: card.card_name,
  cardType: card.card_type.toLowerCase(),
  cost: card.card_cost ? parseInt(card.card_cost) : undefined,
  power: card.card_power ? parseInt(card.card_power) : undefined,
  imageUrl: card.card_image,

  // Transformation needed
  color: parseColors(card.card_color), // "Red/Green" → ["Red", "Green"]

  // Additional useful fields
  text: card.card_text,
  rarity: card.rarity,
  counter: card.counter_amount,
  life: card.life,
  attribute: card.attribute,
  traits: card.sub_types?.split(' ') || [],
  set: {
    id: card.set_id,
    name: card.set_name
  }
}
```

### Color Parsing

Multi-color cards in OPTCG API use format like "Red/Green". Need transformation:

```typescript
function parseColors(colorString: string): string[] {
  if (!colorString) return [];
  return colorString.split('/').map(c => c.trim());
}
```

---

## Recommended Implementation Strategy

### Phase 1: Primary Data Source (OPTCG API)

1. Fetch all sets via `/allSets/`
2. For each set, fetch cards via `/sets/{set_id}/`
3. Fetch starter deck cards via `/allSTCards/`
4. Fetch promo cards via `/allPromoCards/`
5. Download images from `card_image` URLs

### Phase 2: Data Validation

1. Cross-reference card counts with Limitless TCG
2. Verify sample cards against official site
3. Check for missing or malformed data

### Phase 3: Backup Strategy

1. Store vegapull-records as static backup
2. Implement fallback to ryanmichaelhirst API if primary fails
3. Consider periodic vegapull runs for verification

### Rate Limiting Strategy

```typescript
const RATE_LIMIT_CONFIG = {
  requestsPerMinute: 30,     // Conservative estimate
  delayBetweenRequests: 2000, // 2 seconds
  retryAttempts: 3,
  retryDelay: 5000
};
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| OPTCG API goes offline | High | Backup to ryanmichaelhirst or vegapull-records |
| Rate limiting enforced | Medium | Implement exponential backoff, cache aggressively |
| Data format changes | Medium | Schema validation, alerting on parse errors |
| Image hosting changes | High | Download and self-host images |
| Legal/ToS issues | High | Use only free APIs, no scraping official site |

---

## Conclusion

**Primary Source:** OPTCG API (optcgapi.com)
- Free, comprehensive, well-documented
- Direct image URLs
- Active maintenance

**Backup Source:** vegapull-records + ryanmichaelhirst API
- Static dataset for offline/failover
- Alternative API for redundancy

**Avoid:**
- API TCG (requires registration)
- Direct scraping of official site (ToS violation)
- onepiece-cardgame.dev (not accessible)

The recommended approach provides reliable access to complete One Piece TCG card data while respecting rate limits and avoiding legal issues.
