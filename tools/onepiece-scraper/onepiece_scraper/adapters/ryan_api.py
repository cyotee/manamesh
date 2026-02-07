"""Adapter for the ryanmichaelhirst OPTCG API — secondary data source."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

from onepiece_scraper.models import CardData, SetInfo

logger = logging.getLogger(__name__)

BASE_URL = "https://optcg-api.com"  # ryanmichaelhirst API


class RyanApiAdapter:
    """Secondary adapter using the ryanmichaelhirst OPTCG API.

    Endpoints (from MM-033 research):
      - /api/v1/cards         — paginated card list
      - /api/v1/cards/{id}    — single card
      Query params: page, per_page, search, color, set, type, etc.
    """

    def __init__(self, rate_limit_ms: int = 500) -> None:
        self._rate_limit = rate_limit_ms / 1000.0
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def name(self) -> str:
        return "ryan-api"

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=BASE_URL,
                timeout=30.0,
                headers={"User-Agent": "ManaMesh-OnePieceScraper/0.1"},
            )
        return self._client

    async def _throttle(self) -> None:
        if self._rate_limit > 0:
            await asyncio.sleep(self._rate_limit)

    async def _get_json(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        client = self._get_client()
        await self._throttle()
        resp = await client.get(path, params=params)
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def list_sets(self) -> List[SetInfo]:
        """Derive set list from paginated card data.

        The Ryan API doesn't have a dedicated sets endpoint, so we
        fetch page 1 and look for set metadata, or fall back to
        a hardcoded list derived from MM-033 research.
        """
        # Try to get sets from the first page of cards
        seen: Dict[str, str] = {}
        try:
            data = await self._get_json("/api/v1/cards", params={"per_page": 100, "page": 1})
            cards_list = data if isinstance(data, list) else data.get("data", data.get("cards", []))
            for card in cards_list:
                set_val = str(card.get("set", card.get("code", ""))[:4])
                if set_val and set_val not in seen:
                    seen[set_val] = set_val
        except Exception:
            logger.warning("Ryan API: failed to derive sets from card list")

        sets = [SetInfo(id=sid, name=sid, category="booster") for sid in sorted(seen.keys())]
        logger.info("Ryan API: derived %d sets", len(sets))
        return sets

    async def get_cards(self, set_id: str) -> List[CardData]:
        """Fetch all cards for a set, handling pagination."""
        all_cards: List[CardData] = []
        page = 1
        per_page = 100

        while True:
            data = await self._get_json(
                "/api/v1/cards",
                params={"set": set_id, "per_page": per_page, "page": page},
            )
            cards_list = data if isinstance(data, list) else data.get("data", data.get("cards", []))
            if not cards_list:
                break

            for raw in cards_list:
                try:
                    all_cards.append(self._parse_card(raw, set_id))
                except Exception:
                    logger.warning("Ryan API: failed to parse card: %s", raw.get("code", "?"))

            # If we got fewer than per_page, we've reached the last page
            if len(cards_list) < per_page:
                break
            page += 1

        logger.info("Ryan API: set %s -> %d cards", set_id, len(all_cards))
        return all_cards

    def get_image_url(self, card: CardData) -> str:
        """Return the image URL stored in card data."""
        return card.image_url

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _parse_card(self, raw: Dict[str, Any], default_set_id: str) -> CardData:
        card_id = str(raw.get("code", raw.get("id", "")))
        color_raw = str(raw.get("color", ""))
        colors = [c.strip() for c in color_raw.split("/") if c.strip()] if color_raw else []

        traits_raw = raw.get("class", raw.get("traits", ""))
        if isinstance(traits_raw, str):
            traits = [t.strip() for t in traits_raw.split("/") if t.strip()]
        elif isinstance(traits_raw, list):
            traits = traits_raw
        else:
            traits = []

        return CardData(
            id=card_id,
            name=str(raw.get("name", "")),
            card_type=str(raw.get("type", "")).lower(),
            cost=_int_or_none(raw.get("cost")),
            power=_int_or_none(raw.get("power")),
            counter=_int_or_none(raw.get("counter")),
            colors=colors,
            rarity=str(raw.get("rarity", "")),
            traits=traits,
            text=str(raw.get("effect", raw.get("text", ""))),
            life=_int_or_none(raw.get("life")),
            image_url=str(raw.get("image", "")),
            set_id=default_set_id,
            source=self.name,
        )


def _int_or_none(val: Any) -> Optional[int]:
    if val is None or val == "" or val == "null":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None
