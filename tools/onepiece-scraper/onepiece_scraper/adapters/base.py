"""Base protocol for card source adapters."""

from __future__ import annotations

from typing import List, Protocol, runtime_checkable

from onepiece_scraper.models import CardData, SetInfo


@runtime_checkable
class CardSourceAdapter(Protocol):
    """Protocol that all card source adapters must satisfy.

    Adapters are discovered by name from YAML config and instantiated
    by the scraper orchestrator.  Each adapter knows how to talk to one
    external data source and normalize its output into CardData/SetInfo.
    """

    @property
    def name(self) -> str:
        """Human-readable adapter name for logging."""
        ...

    async def list_sets(self) -> List[SetInfo]:
        """Return all card sets available from this source."""
        ...

    async def get_cards(self, set_id: str) -> List[CardData]:
        """Return all cards in the given set."""
        ...

    def get_image_url(self, card: CardData) -> str:
        """Return the download URL for a card's front image."""
        ...

    async def close(self) -> None:
        """Clean up any resources (HTTP clients, etc.)."""
        ...
