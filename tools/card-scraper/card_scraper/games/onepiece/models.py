"""One Piece TCG card data model."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from card_scraper.models import CardDataBase


@dataclass
class OnePieceCardData(CardDataBase):
    """Normalized card data for One Piece TCG."""

    card_type: str = ""  # "character", "leader", "event", "stage", "don"
    cost: Optional[int] = None
    power: Optional[int] = None
    counter: Optional[int] = None
    colors: list[str] = field(default_factory=list)
    traits: list[str] = field(default_factory=list)
    text: str = ""
    life: Optional[int] = None  # leaders only
