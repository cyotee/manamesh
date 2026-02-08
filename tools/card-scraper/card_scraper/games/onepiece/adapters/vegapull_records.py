"""Adapter for vegapull-records — static local data fallback."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from card_scraper.games.onepiece.models import OnePieceCardData
from card_scraper.models import SetInfo

logger = logging.getLogger(__name__)


class VegapullRecordsAdapter:
    """Last-resort adapter that reads from locally-downloaded vegapull-records archives."""

    def __init__(self, local_path: str = "./data/vegapull-records/") -> None:
        self._local_path = Path(local_path)

    @property
    def name(self) -> str:
        return "vegapull-records"

    async def list_sets(self) -> List[SetInfo]:
        """Discover sets by scanning JSON files in the local data directory."""
        if not self._local_path.exists():
            logger.warning("Vegapull: local path %s does not exist", self._local_path)
            return []

        sets: List[SetInfo] = []
        seen: set = set()

        for json_file in sorted(self._local_path.rglob("*.json")):
            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
                cards_list = data if isinstance(data, list) else data.get("cards", [data])
                for card in cards_list:
                    set_id = self._extract_set_id(card)
                    if set_id and set_id not in seen:
                        seen.add(set_id)
                        sets.append(
                            SetInfo(
                                id=set_id,
                                name=str(card.get("set_name", set_id)),
                                category=self._guess_category(set_id),
                            )
                        )
            except (json.JSONDecodeError, OSError):
                logger.warning("Vegapull: failed to read %s", json_file)

        logger.info("Vegapull: found %d sets from local files", len(sets))
        return sets

    async def get_cards(self, set_id: str) -> List[OnePieceCardData]:
        """Read all cards for a set from local JSON files."""
        if not self._local_path.exists():
            return []

        all_cards: List[OnePieceCardData] = []
        for json_file in sorted(self._local_path.rglob("*.json")):
            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
                cards_list = data if isinstance(data, list) else data.get("cards", [data])
                for raw in cards_list:
                    if self._extract_set_id(raw) == set_id:
                        try:
                            all_cards.append(self._parse_card(raw, set_id))
                        except Exception:
                            pass
            except (json.JSONDecodeError, OSError):
                pass

        logger.info("Vegapull: set %s -> %d cards", set_id, len(all_cards))
        return all_cards

    def get_image_url(self, card: OnePieceCardData) -> str:
        return card.image_url

    async def close(self) -> None:
        pass

    def _extract_set_id(self, raw: Dict[str, Any]) -> Optional[str]:
        set_id = raw.get("set_id", raw.get("setId", raw.get("set", "")))
        if set_id:
            return str(set_id)
        code = str(raw.get("code", raw.get("id", raw.get("card_id", ""))))
        if "-" in code:
            prefix = code.split("-")[0]
            for i, ch in enumerate(prefix):
                if ch.isdigit():
                    alpha = prefix[:i]
                    num = prefix[i:]
                    return f"{alpha}-{num}"
            return prefix
        return None

    def _parse_card(self, raw: Dict[str, Any], default_set_id: str) -> OnePieceCardData:
        card_id = str(raw.get("code", raw.get("id", raw.get("card_id", ""))))
        color_raw = str(raw.get("color", raw.get("card_color", "")))
        colors = [c.strip() for c in color_raw.split("/") if c.strip()] if color_raw else []

        traits_raw = raw.get("traits", raw.get("class", raw.get("sub_types", "")))
        if isinstance(traits_raw, str):
            traits = [t.strip() for t in traits_raw.split("/") if t.strip()]
        elif isinstance(traits_raw, list):
            traits = traits_raw
        else:
            traits = []

        return OnePieceCardData(
            id=card_id,
            name=str(raw.get("name", raw.get("card_name", ""))),
            card_type=str(raw.get("type", raw.get("card_type", ""))).lower(),
            cost=_int_or_none(raw.get("cost", raw.get("card_cost"))),
            power=_int_or_none(raw.get("power", raw.get("card_power"))),
            counter=_int_or_none(raw.get("counter", raw.get("counter_amount"))),
            colors=colors,
            rarity=str(raw.get("rarity", "")),
            traits=traits,
            text=str(raw.get("text", raw.get("effect", raw.get("card_text", "")))),
            life=_int_or_none(raw.get("life")),
            image_url=str(raw.get("image", raw.get("image_url", raw.get("card_image", "")))),
            set_id=default_set_id,
            source="vegapull-records",
        )

    @staticmethod
    def _guess_category(set_id: str) -> str:
        upper = set_id.upper()
        if upper.startswith("ST"):
            return "starter"
        if upper.startswith("OP") or upper.startswith("EB"):
            return "booster"
        if "PROMO" in upper or upper.startswith("P-"):
            return "promo"
        return "extra"


def _int_or_none(val: Any) -> Optional[int]:
    if val is None or val == "" or val == "null":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None
