"""MTG adapter registry."""

from __future__ import annotations

from typing import Dict

# Lazy-loaded adapter registry: name -> module.ClassName
MTG_ADAPTERS: Dict[str, str] = {
    "scryfall-bulk": "card_scraper.games.mtg.adapters.scryfall_bulk.ScryfallBulkAdapter",
    "scryfall-api": "card_scraper.games.mtg.adapters.scryfall_api.ScryfallApiAdapter",
    "mtgjson": "card_scraper.games.mtg.adapters.mtgjson.MtgjsonAdapter",
}
