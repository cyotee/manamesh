"""Base data models for card data, set info, and scrape state.

Game-specific card models extend CardDataBase in their respective
game packages (e.g., games/onepiece/models.py, games/mtg/models.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SetInfo:
    """Metadata about a card set / expansion."""

    id: str  # e.g. "OP-01", "MKM"
    name: str  # e.g. "Romance Dawn", "Murders at Karlov Manor"
    category: str  # "booster", "starter", "promo", "extra", "core", "expansion", etc.


@dataclass
class CardDataBase:
    """Base card data produced by any adapter.

    Subclasses add game-specific fields (e.g., mana_cost for MTG,
    counter for One Piece). All adapters produce instances of the
    appropriate subclass.
    """

    id: str  # Unique card identifier (e.g., "OP01-001", Scryfall UUID)
    name: str
    image_url: str
    set_id: str
    source: str  # Which adapter provided this data
    rarity: str = ""


@dataclass
class CardImageStatus:
    """Download status for a single card image."""

    card_id: str
    status: str  # "success", "failed", "pending"
    path: Optional[str] = None
    error: Optional[str] = None


@dataclass
class SetScrapeState:
    """Scrape state for a single set."""

    set_id: str
    last_scraped: Optional[str] = None  # ISO timestamp
    card_ids: list[str] = field(default_factory=list)
    images: dict[str, CardImageStatus] = field(default_factory=dict)


@dataclass
class ScrapeState:
    """Top-level scrape state tracking across all sets."""

    sets: dict[str, SetScrapeState] = field(default_factory=dict)

    def is_card_scraped(self, set_id: str, card_id: str) -> bool:
        ss = self.sets.get(set_id)
        return ss is not None and card_id in ss.card_ids

    def is_image_downloaded(self, set_id: str, card_id: str) -> bool:
        ss = self.sets.get(set_id)
        if ss is None:
            return False
        img = ss.images.get(card_id)
        return img is not None and img.status == "success"

    def mark_card_scraped(self, set_id: str, card_id: str) -> None:
        ss = self.sets.setdefault(set_id, SetScrapeState(set_id=set_id))
        if card_id not in ss.card_ids:
            ss.card_ids.append(card_id)

    def mark_image(
        self,
        set_id: str,
        card_id: str,
        status: str,
        path: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        ss = self.sets.setdefault(set_id, SetScrapeState(set_id=set_id))
        ss.images[card_id] = CardImageStatus(
            card_id=card_id, status=status, path=path, error=error
        )
