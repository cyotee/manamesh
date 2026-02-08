"""Base protocol for card source adapters and adapter registry."""

from __future__ import annotations

import importlib
from typing import Dict, List, Protocol, Type, runtime_checkable

from card_scraper.models import CardDataBase, SetInfo


@runtime_checkable
class CardSourceAdapter(Protocol):
    """Protocol that all card source adapters must satisfy.

    Adapters are discovered by name from YAML config and instantiated
    by the scraper orchestrator.  Each adapter knows how to talk to one
    external data source and normalize its output into game-specific
    CardDataBase subclasses and SetInfo.
    """

    @property
    def name(self) -> str:
        """Human-readable adapter name for logging."""
        ...

    async def list_sets(self) -> List[SetInfo]:
        """Return all card sets available from this source."""
        ...

    async def get_cards(self, set_id: str) -> List[CardDataBase]:
        """Return all cards in the given set."""
        ...

    def get_image_url(self, card: CardDataBase) -> str:
        """Return the download URL for a card's front image."""
        ...

    async def close(self) -> None:
        """Clean up any resources (HTTP clients, etc.)."""
        ...


# Unified adapter registry: game -> { adapter_name -> qualified class name }
_ADAPTER_REGISTRY: Dict[str, Dict[str, str]] = {
    "onepiece": {
        "optcg-api": "card_scraper.games.onepiece.adapters.optcg_api.OptcgApiAdapter",
        "ryan-api": "card_scraper.games.onepiece.adapters.ryan_api.RyanApiAdapter",
        "vegapull-records": "card_scraper.games.onepiece.adapters.vegapull_records.VegapullRecordsAdapter",
    },
    "mtg": {
        "scryfall-bulk": "card_scraper.games.mtg.adapters.scryfall_bulk.ScryfallBulkAdapter",
        "scryfall-api": "card_scraper.games.mtg.adapters.scryfall_api.ScryfallApiAdapter",
        "mtgjson": "card_scraper.games.mtg.adapters.mtgjson.MtgjsonAdapter",
    },
}


def get_adapter_class(game: str, name: str) -> Type[CardSourceAdapter]:
    """Import and return the adapter class for a game and source name."""
    game_adapters = _ADAPTER_REGISTRY.get(game)
    if game_adapters is None:
        raise ValueError(
            f"Unknown game '{game}'. Available: {list(_ADAPTER_REGISTRY.keys())}"
        )
    qualified = game_adapters.get(name)
    if qualified is None:
        raise ValueError(
            f"Unknown adapter '{name}' for game '{game}'. "
            f"Available: {list(game_adapters.keys())}"
        )
    module_path, class_name = qualified.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


def known_adapters(game: str) -> set[str]:
    """Return the set of known adapter names for a game."""
    game_adapters = _ADAPTER_REGISTRY.get(game, {})
    return set(game_adapters.keys())
