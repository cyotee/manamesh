# MTG Card Data Source Comparison

**Task:** MM-041
**Date:** 2026-02-08

## Side-by-Side Comparison Matrix

### Access & Infrastructure

| Criterion | Scryfall | MTGJSON | MTG GraphQL | Gatherer |
|-----------|----------|---------|-------------|----------|
| Access method | REST API + Bulk JSON | Bulk download (JSON/SQL/CSV) | REST API | Web scraping |
| Authentication | None | None | None | N/A |
| Rate limit | 10 req/s | N/A (download) | ~1.4 req/s (5000/hr) | Unknown |
| Bulk download | Yes (4 files, 161MB-2.3GB) | Yes (all files) | No | No |
| Response format | JSON | JSON, SQL, SQLite, CSV, Parquet | JSON | HTML |
| Update frequency | Daily (12-hour cycle) | Daily | Irregular | Real-time |
| API docs quality | Excellent | Good | Good | None |
| SDKs available | Community (unofficial) | None | Official (8 languages) | None |

### Data Completeness

| Criterion | Scryfall | MTGJSON | MTG GraphQL | Gatherer |
|-----------|----------|---------|-------------|----------|
| Total unique cards | ~95,000+ | ~95,000+ | ~70,000+ (est.) | ~95,000+ |
| All sets covered | Yes | Yes | Partial (lag) | Yes |
| Core/Expansion sets | Yes | Yes | Yes | Yes |
| Commander products | Yes | Yes | Partial | Yes |
| Secret Lair / promo | Yes | Yes | Unlikely | Yes |
| Token cards | Yes | Yes | Partial | Yes |
| Multi-face cards | Excellent (card_faces[]) | Excellent | Partial | Yes |
| Foreign languages | Yes (via All Cards bulk) | Yes (foreignData) | Yes (foreignNames) | Partial |
| Format legalities | Yes (per format) | Yes (per format) | Yes (per format) | Yes |
| Price data | Yes (daily) | Yes (90-day history) | No | No |
| Rulings | Yes (separate endpoint) | Yes (per card) | No | Yes |
| Keywords | Yes (array) | Yes (array) | No | Parse text |
| Artist data | Yes (name + UUID) | Yes (name) | Yes (name) | Yes (name) |

### MTGCard Schema Field Coverage

| MTGCard Field | Scryfall | MTGJSON | MTG GraphQL | Gatherer |
|---------------|----------|---------|-------------|----------|
| `manaCost` | `mana_cost` | `manaCost` | `manaCost` | Scrape |
| `cmc` | `cmc` (decimal) | `manaValue` (number) | `cmc` (number) | Scrape |
| `types[]` | Parse `type_line` | `types[]` | `types[]` | Scrape |
| `subtypes[]` | Parse `type_line` | `subtypes[]` | `subtypes[]` | Scrape |
| `supertypes[]` | Parse `type_line` | `supertypes[]` | `supertypes[]` | Scrape |
| `power` | String (may be `*`) | String (may be `*`) | String | Scrape |
| `toughness` | String (may be `*`) | String (may be `*`) | String | Scrape |
| `loyalty` | String | String | String | Scrape |
| `oracleText` | `oracle_text` | `text` | `text` | Scrape |
| `set` | `set` (code) | `setCode` | `set` (code) | N/A |
| `collectorNumber` | `collector_number` | `number` | `number` | N/A |
| `colors[]` | `colors` (WUBRG) | `colors` (WUBRG) | `colors` | Scrape |
| `colorIdentity[]` | `color_identity` | `colorIdentity` | `colorIdentity` | Scrape |

**Legend:** Direct field = ready to map, Parse = needs string parsing, Scrape = needs HTML parsing

### Image Capabilities

| Criterion | Scryfall | MTGJSON | MTG GraphQL | Gatherer |
|-----------|----------|---------|-------------|----------|
| Images available | Yes | **No** | Via Gatherer URL | Yes (scrape) |
| PNG (transparent) | Yes (745x1040) | No | No | No |
| High-res JPG | Yes (672x936) | No | No | Unknown |
| Normal JPG | Yes (488x680) | No | Yes (Gatherer) | Yes |
| Thumbnails | Yes (146x204) | No | No | No |
| Art crop | Yes (variable) | No | No | No |
| Border crop | Yes (480x680) | No | No | No |
| Multi-face images | Yes (per-face URIs) | No | No | Unknown |
| Image CDN rate limit | None | N/A | Gatherer limit | Unknown |
| Image quality status | Yes (highres_scan/lowres/etc.) | No | No | No |

### Reliability & Maintenance

| Criterion | Scryfall | MTGJSON | MTG GraphQL | Gatherer |
|-----------|----------|---------|-------------|----------|
| Active maintenance | Very active | Active | Low activity | Active (Wizards) |
| New set delay | Same day | Same day | Days to weeks | Same day |
| Community trust | Very high | High | Moderate | Authoritative |
| ToS friendliness | Community-friendly | Open source | Open | Restrictive |
| Stability | Very stable | Stable | Moderate | Stable but fragile |
| Error handling | Well-documented | N/A (files) | Basic | N/A |

## Scoring Summary

| Source | Data (40) | Images (25) | Access (20) | Reliability (15) | Total (100) |
|--------|-----------|-------------|-------------|-------------------|-------------|
| **Scryfall** | 38 | 25 | 18 | 14 | **95** |
| **MTGJSON** | 39 | 0 | 17 | 13 | **69** |
| MTG GraphQL | 28 | 10 | 15 | 8 | **61** |
| Gatherer | 36 | 12 | 5 | 10 | **63** |

## Recommendation

**Use Scryfall as the sole primary source.** It is the only source that provides both comprehensive data AND high-quality images with an API that is well-documented and community-friendly.

**MTGJSON as optional enrichment:** If we need cross-reference identifiers (MTGO ID, Arena ID, TCGplayer ID) or SQLite offline querying, MTGJSON can supplement Scryfall data. Not required for core functionality.

**Skip MTG GraphQL and Gatherer entirely** - everything they provide is available in Scryfall with better quality and access.
