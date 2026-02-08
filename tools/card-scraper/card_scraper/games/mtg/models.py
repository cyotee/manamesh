"""Magic: The Gathering card data model."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from card_scraper.models import CardDataBase


@dataclass
class MTGCardData(CardDataBase):
    """MTG-specific card data with typed fields."""

    mana_cost: Optional[str] = None
    cmc: float = 0.0
    types: list[str] = field(default_factory=list)
    subtypes: list[str] = field(default_factory=list)
    supertypes: list[str] = field(default_factory=list)
    power: Optional[str] = None  # String: can be *, X, 1+*, etc.
    toughness: Optional[str] = None  # String: can be *, X, 1+*, etc.
    loyalty: Optional[str] = None  # String: can be X, etc.
    oracle_text: str = ""
    colors: list[str] = field(default_factory=list)
    color_identity: list[str] = field(default_factory=list)
    layout: str = "normal"
    card_faces: Optional[list[dict]] = None
    keywords: list[str] = field(default_factory=list)
    collector_number: str = ""
    cross_ref_ids: dict[str, str] = field(default_factory=dict)
