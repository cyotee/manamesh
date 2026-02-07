"""Data models for card data, set info, and scrape state."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SetInfo:
    """Metadata about a card set / expansion."""

    id: str  # e.g. "OP-01"
    name: str  # e.g. "Romance Dawn"
    category: str  # "booster", "starter", "promo", "extra"


@dataclass
class CardData:
    """Normalized card data produced by any adapter."""

    id: str  # e.g. "OP01-001"
    name: str
    card_type: str  # "character", "leader", "event", "stage", "don"
    cost: Optional[int]
    power: Optional[int]
    counter: Optional[int]
    colors: list[str]
    rarity: str
    traits: list[str]
    text: str
    life: Optional[int]  # leaders only
    image_url: str
    set_id: str
    source: str  # which adapter provided this data


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
