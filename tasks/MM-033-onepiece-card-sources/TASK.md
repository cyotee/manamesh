# Task MM-033: One Piece Card Data Sources Research

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-31
**Dependencies:** None
**Worktree:** `feature/onepiece-card-sources`

---

## Description

Research and evaluate all available One Piece TCG card data sources for scraping card data and images. The goal is to identify the best sources for building asset packs, evaluate data completeness, and design how card data maps to the ManaMesh asset pack manifest format.

## Dependencies

None - this is pure research that can proceed independently.

## User Stories

### US-MM-033.1: Card Source Inventory

As a developer, I want a comprehensive inventory of One Piece card data sources so that I can choose the best option for asset pack creation.

**Acceptance Criteria:**
- [ ] Document all known sources (APIs, scrapers, databases)
- [ ] For each source, document: URL, access method, data format
- [ ] Identify which sources provide card images
- [ ] Note any rate limits or access restrictions
- [ ] Evaluate data freshness (how quickly new sets are added)

### US-MM-033.2: Data Completeness Evaluation

As a developer, I want to understand the data completeness of each source so that I can ensure all required card fields are available.

**Acceptance Criteria:**
- [ ] List all sets/expansions available from each source
- [ ] Map source fields to OnePieceCard schema (core fields: id, name, cardType, cost, power, color, imageCid)
- [ ] Identify any missing fields or incomplete data
- [ ] Compare promo card coverage across sources
- [ ] Document DON!! card data availability

### US-MM-033.3: Asset Pack Manifest Design

As a developer, I want a designed mapping from source data to ManaMesh asset pack format so that I can build One Piece card packs.

**Acceptance Criteria:**
- [ ] Design One Piece-specific asset pack manifest structure
- [ ] Map source card IDs to pack asset IDs
- [ ] Define image file naming conventions
- [ ] Specify how multi-color cards are handled
- [ ] Document Leader vs Character vs Event vs Stage card type mappings

### US-MM-033.4: Recommended Approach

As a developer, I want a clear recommendation on which source(s) to use so that implementation can proceed efficiently.

**Acceptance Criteria:**
- [ ] Provide ranked recommendation of sources
- [ ] Justify recommendation based on completeness, reliability, ease of use
- [ ] Outline hybrid approach if multiple sources needed
- [ ] Identify any blockers or risks

## Technical Details

### Sources to Evaluate

| Source | Type | URL |
|--------|------|-----|
| OPTCG API | REST API | https://optcgapi.com/ |
| API TCG | REST API | https://apitcg.com/ |
| Vegapull | CLI Scraper | https://github.com/Coko7/vegapull |
| Limitless TCG | Database | https://onepiece.limitlesstcg.com/cards |
| onepiece-cardgame.dev | Database | https://onepiece-cardgame.dev/ |
| Official Site | Source | https://en.onepiece-cardgame.com/ |

### Core Card Fields Required

```typescript
// Minimum fields needed for asset packs
interface OnePieceCardCore {
  id: string;              // Unique identifier
  name: string;            // Card name
  cardType: 'character' | 'leader' | 'event' | 'stage' | 'don';
  cost?: number;           // Play cost
  power?: number;          // Base power
  color: string[];         // Card color(s)
  imageUrl: string;        // Source image URL for download
}
```

### Asset Pack Manifest Template

```json
{
  "manifest_version": "1.0",
  "pack_id": "onepiece-{set_code}",
  "pack_type": "card_faces",
  "name": "One Piece {Set Name}",
  "game_module": "onepiece",
  "version": "1.0.0",

  "asset_schema": {
    "id_format": "{source}_id",
    "asset_types": ["card_face", "card_back"]
  },

  "assets": []
}
```

## Files to Create/Modify

**New Files:**
- `RESEARCH_OnePiece_CardSources.md` (repo root) - Main research document
- `tasks/MM-033-onepiece-card-sources/source-comparison.md` - Detailed comparison table

**No code files** - this is a research + design task.

## Inventory Check

Before starting, verify:
- [ ] Internet access for API testing
- [ ] Ability to make sample API requests
- [ ] Access to PRD.md for asset pack format reference

## Completion Criteria

- [ ] All sources documented in RESEARCH_OnePiece_CardSources.md
- [ ] Data completeness evaluated for each source
- [ ] Asset pack manifest design completed
- [ ] Clear recommendation provided
- [ ] No implementation code (research only)

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
