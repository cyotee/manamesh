"""One Piece TCG adapter registry."""

from __future__ import annotations

from typing import Dict

# Lazy-loaded adapter registry: name -> module.ClassName
ONEPIECE_ADAPTERS: Dict[str, str] = {
    "optcg-api": "card_scraper.games.onepiece.adapters.optcg_api.OptcgApiAdapter",
    "ryan-api": "card_scraper.games.onepiece.adapters.ryan_api.RyanApiAdapter",
    "vegapull-records": "card_scraper.games.onepiece.adapters.vegapull_records.VegapullRecordsAdapter",
}
