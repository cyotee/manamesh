# Standard Playing Cards Asset Pack

A complete 52-card playing deck with card backs for use in ManaMesh card games.

## Contents

- 52 standard playing cards (4 suits × 13 ranks)
- 2 jokers (red and black)
- Card back design
- Card base (blank card template)

## Source

**Original artwork:** [Playing Cards by Kenney](https://opengameart.org/content/playing-cards-0)
**License:** CC0 (Public Domain)

## Usage

### Loading the Manifest

```typescript
import manifest from '@/assets/packs/standard-playing-cards/manifest.json';

// Access all assets
const cards = manifest.assets.filter(a => a.type === 'card_face');
const cardBack = manifest.assets.find(a => a.type === 'card_back');
```

### Asset ID Format

Cards use the `suit-rank` format:

- **Suits:** `clubs`, `diamonds`, `hearts`, `spades`
- **Ranks:** `A`, `2`-`10`, `J`, `Q`, `K`

Examples:
- `clubs-A` - Ace of Clubs
- `hearts-K` - King of Hearts
- `spades-10` - Ten of Spades
- `diamonds-J` - Jack of Diamonds

### Special Assets

| ID | Type | Description |
|----|------|-------------|
| `joker-red` | joker | Red joker |
| `joker-black` | joker | Black joker |
| `back` | card_back | Card back design |
| `base` | card_base | Blank card template |

### Card Values

Each card has a numeric `value` property:
- Ace = 1
- 2-10 = face value
- Jack = 11
- Queen = 12
- King = 13

### Example: Get Cards by Suit

```typescript
const hearts = manifest.assets.filter(
  a => a.type === 'card_face' && a.suit === 'hearts'
);
```

### Example: Build a Deck

```typescript
const deck = manifest.assets
  .filter(a => a.type === 'card_face')
  .map(card => ({
    id: card.id,
    imagePath: `assets/packs/standard-playing-cards/${card.file}`,
    suit: card.suit,
    rank: card.rank,
    value: card.value,
  }));
```

## Supported Games

This asset pack is designed for:
- War
- Poker

## Integrity Verification

SHA-256 checksums for all assets are provided in `checksums.sha256`.

```bash
cd assets/packs/standard-playing-cards
shasum -a 256 -c checksums.sha256
```

## File Structure

```
standard-playing-cards/
├── manifest.json       # Asset metadata and mappings
├── checksums.sha256    # SHA-256 integrity hashes
├── README.md           # This file
└── cards/
    ├── 1.png           # Ace of Clubs
    ├── 2.png           # 2 of Clubs
    ├── ...
    ├── 52.png          # King of Spades
    ├── 53.png          # Red Joker
    ├── 54.png          # Black Joker
    ├── back.png        # Card back
    └── base.png        # Card base
```
