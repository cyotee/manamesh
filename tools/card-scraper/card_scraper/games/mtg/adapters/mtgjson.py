"""MTGJSON adapter — secondary data enrichment source.

Reads from a locally-downloaded AllPrintings.json file.
No network access required.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from card_scraper.games.mtg.models import MTGCardData
from card_scraper.games.mtg.type_parser import parse_type_line
from card_scraper.models import SetInfo

logger = logging.getLogger(__name__)


class MtgjsonAdapter:
    """Secondary MTG adapter reading from local MTGJSON AllPrintings.json.

    Used for data enrichment and cross-reference IDs.
    Does not provide images — use Scryfall adapters for that.

    To download the data:
      curl -L https://mtgjson.com/api/v5/AllPrintings.json.xz -o AllPrintings.json.xz
      xz -d AllPrintings.json.xz
    """

    def __init__(
        self,
        local_path: str = "./data/mtgjson/AllPrintings.json",
    ) -> None:
        self._local_path = Path(local_path)
        self._data_cache: Optional[Dict[str, Any]] = None

    @property
    def name(self) -> str:
        return "mtgjson"

    def _load_data(self) -> Dict[str, Any]:
        """Load and cache the AllPrintings data."""
        if self._data_cache is not None:
            return self._data_cache

        if not self._local_path.exists():
            logger.warning("MTGJSON: file not found at %s", self._local_path)
            return {}

        logger.info("Loading MTGJSON data from %s ...", self._local_path)
        with open(self._local_path, "r", encoding="utf-8") as f:
            raw = json.load(f)

        # AllPrintings wraps sets under "data" key
        self._data_cache = raw.get("data", raw)
        logger.info("MTGJSON: loaded %d sets", len(self._data_cache))
        return self._data_cache

    async def list_sets(self) -> List[SetInfo]:
        """List all sets available in the MTGJSON data."""
        data = self._load_data()
        sets: List[SetInfo] = []

        for set_code, set_data in data.items():
            sets.append(
                SetInfo(
                    id=set_code.upper(),
                    name=set_data.get("name", set_code),
                    category=set_data.get("type", "expansion"),
                )
            )

        logger.info("MTGJSON: found %d sets", len(sets))
        return sorted(sets, key=lambda s: s.id)

    async def get_cards(self, set_id: str) -> List[MTGCardData]:
        """Get all cards for a set from MTGJSON data."""
        data = self._load_data()

        # MTGJSON uses uppercase set codes
        set_data = data.get(set_id.upper()) or data.get(set_id.lower())
        if not set_data:
            logger.warning("MTGJSON: set %s not found", set_id)
            return []

        raw_cards = set_data.get("cards", [])
        cards: List[MTGCardData] = []

        for raw in raw_cards:
            try:
                cards.append(_parse_mtgjson_card(raw, set_id))
            except Exception as exc:
                logger.warning(
                    "MTGJSON: failed to parse card %s: %s",
                    raw.get("name", "?"), exc,
                )

        logger.info("MTGJSON: set %s -> %d cards", set_id, len(cards))
        return cards

    def get_image_url(self, card: MTGCardData) -> str:
        """MTGJSON doesn't provide images — return empty string."""
        return card.image_url or ""

    async def close(self) -> None:
        pass  # No resources to clean up


def _parse_mtgjson_card(raw: Dict[str, Any], set_id: str) -> MTGCardData:
    """Parse a MTGJSON card object into MTGCardData."""
    # MTGJSON already provides separate types/subtypes/supertypes
    types = raw.get("types", [])
    subtypes = raw.get("subtypes", [])
    supertypes = raw.get("supertypes", [])

    # If arrays are missing, fall back to parsing type_line
    if not types and raw.get("type"):
        parsed = parse_type_line(raw["type"])
        types = parsed.types
        subtypes = parsed.subtypes
        supertypes = parsed.supertypes

    # Extract cross-reference identifiers
    identifiers = raw.get("identifiers", {})
    cross_ref_ids: Dict[str, str] = {}
    for key in ("scryfallId", "scryfallOracleId", "mtgoId", "mtgoFoilId",
                "multiverseId", "tcgplayerProductId"):
        val = identifiers.get(key)
        if val:
            cross_ref_ids[key] = str(val)

    return MTGCardData(
        id=raw.get("uuid", ""),
        name=raw.get("name", ""),
        image_url="",  # MTGJSON doesn't provide images
        set_id=set_id,
        source="mtgjson",
        rarity=raw.get("rarity", ""),
        mana_cost=raw.get("manaCost"),
        cmc=float(raw.get("manaValue", raw.get("convertedManaCost", 0))),
        types=types,
        subtypes=subtypes,
        supertypes=supertypes,
        power=raw.get("power"),
        toughness=raw.get("toughness"),
        loyalty=raw.get("loyalty"),
        oracle_text=raw.get("text", ""),
        colors=raw.get("colors", []),
        color_identity=raw.get("colorIdentity", []),
        layout=raw.get("layout", "normal"),
        card_faces=None,  # MTGJSON handles faces differently
        keywords=raw.get("keywords", []),
        collector_number=raw.get("number", ""),
        cross_ref_ids=cross_ref_ids,
    )
