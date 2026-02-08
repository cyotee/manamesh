# Task MM-041: MTG Card Data Sources Research

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-08
**Dependencies:** None
**Worktree:** `feature/mtg-card-sources`

---

## Description

Research and evaluate all available Magic: The Gathering card data sources for scraping card data and images. This follows the same pattern as MM-033 (One Piece card data research). The goal is to identify the best sources for building MTG asset packs, evaluate data completeness against the MTGCard schema defined in MM-024, and design how MTG card data maps to the ManaMesh asset pack manifest format.

The findings will inform a future task to add MTG adapter modules to the existing scraper tool (`tools/onepiece-scraper/`, to be renamed to a general-purpose `tools/card-scraper/`).

## Dependencies

None - this is pure research that can proceed independently.

## User Stories

### US-041.1: MTG Card Source Inventory

As a developer, I want a comprehensive inventory of MTG card data sources so that I can choose the best option for asset pack creation.

**Acceptance Criteria:**
- [ ] Document all four candidate sources (see Sources to Evaluate below)
- [ ] For each source, document: URL, access method (REST API / bulk download / scrape), data format (JSON / CSV), authentication requirements
- [ ] Identify which sources provide card images (and at what resolution)
- [ ] Note rate limits, API keys, or access restrictions for each
- [ ] Evaluate data freshness (how quickly new sets are added after release)
- [ ] Check terms of service / usage policies for each source
- [ ] Document API endpoint structure and pagination patterns

### US-041.2: Data Completeness Evaluation

As a developer, I want to understand the data completeness of each source so that I can ensure all MTGCard schema fields are available.

**Acceptance Criteria:**
- [ ] Map each source's fields to the MTGCard schema (from MM-024 TASK.md):
  - `manaCost` (string, e.g., "{2}{W}{U}")
  - `cmc` (number, converted mana cost)
  - `types` (string[], e.g., ['Creature', 'Artifact'])
  - `subtypes` (string[], e.g., ['Elf', 'Warrior'])
  - `supertypes` (string[], e.g., ['Legendary', 'Snow'])
  - `power` (number)
  - `toughness` (number)
  - `loyalty` (number, planeswalkers)
  - `oracleText` (string)
  - `set` (string, set code)
  - `collectorNumber` (string)
  - `colors` (array of 'W'|'U'|'B'|'R'|'G')
  - `colorIdentity` (array of 'W'|'U'|'B'|'R'|'G')
- [ ] List all sets/expansions available from each source
- [ ] Evaluate coverage of special products: Commander decks, Secret Lair, promo cards, token cards
- [ ] Check multi-face card support (transform, modal DFC, adventure, split, flip, meld)
- [ ] Document card legality data availability (Standard, Modern, Commander, etc.)
- [ ] Compare total card count across sources for accuracy

### US-041.3: Image Source Evaluation

As a developer, I want to understand image availability and quality from each source so that I can build visually complete asset packs.

**Acceptance Criteria:**
- [ ] Document image formats available (PNG, JPG, SVG)
- [ ] Document image resolutions/sizes (thumbnail, small, normal, large, art_crop, border_crop)
- [ ] Check availability of: card front, card back, art-only crops
- [ ] Evaluate image quality (compression artifacts, watermarks)
- [ ] Check multi-face card image handling (both faces available?)
- [ ] Document image URL patterns for direct download
- [ ] Note any image-specific rate limits or restrictions

### US-041.4: Asset Pack Manifest Mapping

As a developer, I want a designed mapping from MTG source data to ManaMesh asset pack format so that a future scraper task can implement it directly.

**Acceptance Criteria:**
- [ ] Design MTG-specific asset pack manifest structure
- [ ] Map source card IDs to pack asset IDs (e.g., Scryfall ID vs collector number)
- [ ] Define image file naming conventions for MTG cards
- [ ] Specify how multi-face cards are handled in the manifest (separate entries? nested?)
- [ ] Document how to handle reprints (same card in multiple sets)
- [ ] Define set categorization: core sets, expansions, commander, masters, supplemental, promo
- [ ] Provide sample manifest JSON for one set

### US-041.5: Adapter Architecture Recommendation

As a developer, I want a clear recommendation on how to extend the existing scraper tool with MTG support so that I can plan the implementation task.

**Acceptance Criteria:**
- [ ] Ranked recommendation of data sources (primary, secondary, fallback)
- [ ] Justify recommendation based on: completeness, reliability, image quality, rate limits, terms of service
- [ ] Outline how to refactor `tools/onepiece-scraper/` into a general `tools/card-scraper/` with game-specific adapter sets
- [ ] Identify shared infrastructure (downloader, state tracker, manifest generator) vs game-specific code (adapters, field mappers)
- [ ] Propose config.yaml structure for multi-game support
- [ ] Estimate card count and download size for a full MTG scrape (all sets)
- [ ] Identify any blockers or risks

## Technical Details

### Sources to Evaluate

| Source | Type | URL | Notes |
|--------|------|-----|-------|
| Scryfall | REST API | https://scryfall.com/docs/api | Gold standard for MTG data. Free, no auth. |
| MTGJSON | Bulk JSON | https://mtgjson.com/ | Complete metadata, no images. Downloadable files. |
| MTG GraphQL | REST/GraphQL API | https://magicthegathering.io/ | Older, community-driven. |
| Gatherer | Web scrape | https://gatherer.wizards.com/ | Official WotC database. Limited programmatic access. |

### MTGCard Schema (from MM-024)

```typescript
interface MTGCard extends CoreCard {
  manaCost?: string;
  cmc: number;
  types: string[];
  subtypes?: string[];
  supertypes?: string[];
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

### Existing Scraper Architecture (from MM-037)

The existing tool uses a pluggable adapter pattern:

```python
class CardSourceAdapter(Protocol):
    @property
    def name(self) -> str: ...
    async def list_sets(self) -> list[SetInfo]: ...
    async def get_cards(self, set_id: str) -> list[CardData]: ...
    def get_image_url(self, card: CardData) -> str: ...
```

The research should evaluate how well each MTG source fits this adapter interface, and what modifications (if any) the shared `CardData` model needs to accommodate MTG-specific fields (mana cost, power/toughness, loyalty, multi-face, etc.).

### Key Questions to Answer

1. Can Scryfall serve as a single comprehensive source, or do we need fallbacks?
2. How should multi-face cards (DFCs, split cards, adventures) be represented?
3. What's the total data volume for all MTG sets? (cards x image size)
4. Does the `CardData` model need game-specific subclasses, or can we use a flat metadata dict?
5. How should reprints be handled (same card in 10+ sets)?

## Files to Create/Modify

**New Files:**
- `RESEARCH_MTG_CardSources.md` (repo root) - Main research document
- `tasks/MM-041-mtg-card-sources/source-comparison.md` - Detailed comparison table

**No code files** - this is a research + design task.

## Inventory Check

Before starting, verify:
- [ ] Internet access for API testing
- [ ] Ability to make sample API requests (curl/httpie)
- [ ] MM-033 research document available for pattern reference
- [ ] MM-037 scraper code available for adapter interface reference
- [ ] MM-024 TASK.md available for MTGCard schema reference

## Completion Criteria

- [ ] All four sources documented in RESEARCH_MTG_CardSources.md
- [ ] Data completeness evaluated and field mappings created for each source
- [ ] Image availability and quality assessed
- [ ] Asset pack manifest mapping designed for MTG
- [ ] Clear ranked recommendation provided with justification
- [ ] Adapter architecture recommendation for extending existing tool
- [ ] No implementation code (research only)

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
