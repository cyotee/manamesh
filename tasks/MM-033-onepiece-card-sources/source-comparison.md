# One Piece TCG Data Sources - Detailed Comparison

**Task:** MM-033
**Date:** 2026-01-31

## Quick Reference Matrix

| Criteria | OPTCG API | OPTCG (ryanmichaelhirst) | API TCG | Vegapull | Vegapull-records | Limitless TCG | Official Site |
|----------|-----------|-------------------------|---------|----------|------------------|---------------|---------------|
| **Access Type** | REST API | REST API | REST API | CLI Tool | Static Files | Web Only | Web Only |
| **Auth Required** | No | No | **Yes** | No | No | N/A | N/A |
| **Rate Limits** | Informal | Unknown | Unknown | N/A | N/A | N/A | N/A |
| **Cost** | Free | Free | Free* | Free | Free | Free | Free |
| **Real-time Data** | Yes | Yes | Yes | On-demand | No | N/A | N/A |
| **Image URLs** | Direct | Direct | Direct | Download | Archive | N/A | N/A |
| **Scraping Risk** | None | None | None | **High** | None | **High** | **Prohibited** |

*Requires registration

---

## Data Field Comparison

### Core Card Fields

| Field | OPTCG API | OPTCG (ryan) | API TCG | Vegapull |
|-------|-----------|--------------|---------|----------|
| Unique ID | `card_set_id` | `code` | `id`/`code` | TBD |
| Name | `card_name` | `name` | `name` | Yes |
| Card Type | `card_type` | `type` | `type` | Yes |
| Cost | `card_cost` | `cost` | `cost` | Yes |
| Power | `card_power` | `power` | `power` | Yes |
| Counter | `counter_amount` | `counter` | `counter` | Yes |
| Color(s) | `card_color` | `color` | `color` | `colors` |
| Rarity | `rarity` | `rarity` | `rarity` | Yes |
| Attribute | `attribute` | `attribute` | `attribute.name` | Yes |
| Card Text | `card_text` | `effect` | `ability` | Yes |
| Life (Leaders) | `life` | N/A | N/A | Yes |
| Set ID | `set_id` | `set` | `set.name` | pack_id |
| Set Name | `set_name` | N/A | `set.name` | pack_name |
| Traits | `sub_types` | `class` | `family` | Yes |
| Trigger | N/A | N/A | `trigger` | Yes |

### Extended Fields

| Field | OPTCG API | OPTCG (ryan) | API TCG | Vegapull |
|-------|-----------|--------------|---------|----------|
| Market Price | `market_price` | No | No | No |
| Inventory Price | `inventory_price` | No | No | No |
| Price History | 13-day | No | No | No |
| Date Scraped | `date_scraped` | No | No | No |
| Small Image | No | No | `images.small` | No |
| Large Image | `card_image` | `image` | `images.large` | Download |
| Attribute Icon | No | No | `attribute.image` | No |

---

## API Endpoint Comparison

### OPTCG API (optcgapi.com)

```
Base: https://optcgapi.com/api/

Collections:
  /allSets/           → List all sets
  /allSetCards/       → All set cards
  /allDecks/          → All starter decks
  /allSTCards/        → All starter deck cards
  /allPromoCards/     → All promo cards

By Collection:
  /sets/{id}/         → Cards in set
  /decks/{id}/        → Cards in starter deck

Individual Cards:
  /sets/card/{id}/    → Card by ID
  /decks/card/{id}/   → Starter deck card
  /promos/card/{id}/  → Promo card

Filtered Search:
  /sets/filtered/     → Filter set cards
  /decks/filtered/    → Filter starter cards
  /promos/filtered/   → Filter promo cards

Price History:
  /sets/card/twoweeks/{id}/
  /decks/card/twoweeks/{id}/
  /promos/card/twoweeks/{id}/
```

### OPTCG API (ryanmichaelhirst)

```
Base: https://optcg-api.ryanmichaelhirst.us/api/v1/

Cards:
  /cards              → List with pagination
  /cards/{id}         → Single card

Query Params:
  page, per_page, search, color, set, type,
  cost, class, counter, power, rarity
```

### API TCG

```
Base: https://apitcg.com/api/one-piece/

Cards:
  /cards              → All cards
  /cards?{prop}={val} → Filtered
  /cards/{id}         → Single card

Filterable: id, code, rarity, type, name, cost,
            power, counter, color, family, ability, trigger
```

---

## Image Availability

### OPTCG API

```
URL Pattern: https://optcgapi.com/media/static/Card_Images/{card_image_id}.jpg

Example: https://optcgapi.com/media/static/Card_Images/OP01-077.jpg

Format: JPEG
Resolution: High (suitable for display)
Access: Direct URL (no auth)
```

### API TCG

```
Small: {images.small}
Large: {images.large}

Both provided in response
Format: Unknown
Access: Via API (requires auth)
```

### Vegapull-records

```
Location: GitHub Releases (archive download)
Format: Unknown
Access: Manual download required
```

---

## Set Coverage Comparison

### OPTCG API Sets (18 total as of 2026-01-31)

| Set ID | Set Name |
|--------|----------|
| OP-01 | Romance Dawn |
| OP-02 | Paramount War |
| OP-03 | Pillars of Strength |
| OP-04 | Kingdoms of Intrigue |
| OP-05 | Awakening of the New Era |
| OP-06 | Wings of the Captain |
| OP-07 | 500 Years in the Future |
| OP-08 | Two Legends |
| OP-09 | Emperors in the New World |
| OP-10 | Royal Blood |
| OP-11 | A Fist of Divine Speed |
| OP-12 | Legacy of the Master |
| OP-13 | Carrying On His Will |
| OP14-EB04 | The Azure Sea's Seven |
| EB-01 | Extra Booster: Memorial Collection |
| EB-02 | Extra Booster: Anime 25th Collection |
| PRB-01 | Premium Booster - The Best |
| PRB-02 | Premium Booster - The Best - Vol. 2 |

*Plus all starter decks and promo cards*

### Limitless TCG Coverage

| Category | Count |
|----------|-------|
| Booster Packs | 14 (OP01-OP14, EB01-EB03, PRB01-PRB02) |
| Starter Decks | 29 (ST01-ST29) |
| Cards per Set | 80-319 |

---

## Reliability & Maintenance

| Source | Last Known Update | Maintenance | Stability |
|--------|-------------------|-------------|-----------|
| OPTCG API | 2026-01-31 (daily scrape) | Active | High |
| OPTCG (ryan) | Unknown | Unknown | Medium |
| API TCG | 2025-09-01 (repo) | Active | Medium |
| Vegapull | 2026-01-20 (v1.2.0) | Active | High |
| Vegapull-records | 2025-04-27 | Periodic | Medium |
| Limitless TCG | Continuous | Professional | High |
| Official Site | Continuous | Official | High |

---

## Legal & Compliance

| Source | ToS Status | Commercial Use | Attribution |
|--------|------------|----------------|-------------|
| OPTCG API | Permissive | Unknown | Recommended |
| OPTCG (ryan) | Open Source | Allowed | Required |
| API TCG | Registration Required | Check Terms | Unknown |
| Vegapull | GPL-3.0 | With conditions | Required |
| Vegapull-records | GPL-3.0 | With conditions | Required |
| Limitless TCG | No Scraping | No | N/A |
| Official Site | **Prohibited** | **No** | N/A |

### Official Site Statement

> "All images, text and data on this website may not be reproduced without permission."

---

## Recommended Use Cases

| Use Case | Recommended Source | Reason |
|----------|-------------------|--------|
| Real-time card data | OPTCG API | Free, comprehensive, updated daily |
| Image downloads | OPTCG API | Direct URLs, high quality |
| Backup/failover | Vegapull-records + ryanmichaelhirst | Static + API redundancy |
| Price tracking | OPTCG API | Only source with pricing |
| Data verification | Limitless TCG | Most comprehensive filters |
| Official accuracy | Official Site | Source of truth (manual only) |
| Multi-TCG projects | API TCG | If registration acceptable |

---

## Implementation Priority

### Tier 1 (Primary)
1. **OPTCG API** - Main data source
   - All endpoints needed
   - Image downloading
   - Daily sync recommended

### Tier 2 (Backup)
2. **ryanmichaelhirst API** - Failover API
3. **vegapull-records** - Static cache

### Tier 3 (Reference)
4. **Limitless TCG** - Manual verification
5. **Official Site** - Truth checking

### Not Recommended
- API TCG (auth barrier)
- onepiece-cardgame.dev (not accessible)
- Direct scraping of official site (ToS)

---

## Sample API Requests

### OPTCG API - Get All Sets

```bash
curl https://optcgapi.com/api/allSets/
```

### OPTCG API - Get Cards from Set

```bash
curl https://optcgapi.com/api/sets/OP-01/
```

### OPTCG API - Filtered Search

```bash
curl "https://optcgapi.com/api/sets/filtered/?card_name=Luffy&color=Red"
```

### ryanmichaelhirst - Paginated Cards

```bash
curl "https://optcg-api.ryanmichaelhirst.us/api/v1/cards?page=1&per_page=50"
```

### API TCG (requires API key)

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://apitcg.com/api/one-piece/cards?name=luffy"
```

---

## Conclusion

**OPTCG API (optcgapi.com)** is the clear winner for ManaMesh integration:

- Complete coverage of all released cards
- No authentication required
- Direct image URLs
- Includes pricing data (bonus)
- Active daily maintenance
- Simple REST interface

Use vegapull-records and ryanmichaelhirst API as backup sources for redundancy.
