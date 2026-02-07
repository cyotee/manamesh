"""Adapter for the OPTCG API (optcgapi.com) — primary data source."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

from onepiece_scraper.models import CardData, SetInfo

logger = logging.getLogger(__name__)

BASE_URL = "https://optcgapi.com"
IMAGE_BASE = f"{BASE_URL}/media/static/Card_Images"


class OptcgApiAdapter:
    """Primary adapter using optcgapi.com REST endpoints.

    Endpoints (from MM-033 research):
      - /api/allSets/         — list all booster sets
      - /api/sets/{id}/       — cards in a specific set
      - /api/allSTCards/      — all starter deck cards
      - /api/allPromoCards/   — all promo cards
    """

    def __init__(self, rate_limit_ms: int = 200) -> None:
        self._rate_limit = rate_limit_ms / 1000.0
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def name(self) -> str:
        return "optcg-api"

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

    async def _get_json(self, path: str) -> Any:
        client = self._get_client()
        await self._throttle()
        resp = await client.get(path)
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def list_sets(self) -> List[SetInfo]:
        """Fetch all booster sets from /api/allSets/."""
        data = await self._get_json("/api/allSets/")
        sets: List[SetInfo] = []
        for item in data:
            sets.append(
                SetInfo(
                    id=str(item.get("id", item.get("set_id", ""))),
                    name=str(item.get("name", item.get("set_name", ""))),
                    category="booster",
                )
            )
        logger.info("OPTCG API: found %d booster sets", len(sets))
        return sets

    async def get_cards(self, set_id: str) -> List[CardData]:
        """Fetch cards for a set.

        Handles three categories:
          - Regular booster sets via /api/sets/{id}/
          - Starter decks via /api/allSTCards/ (set_id starts with "ST")
          - Promos via /api/allPromoCards/ (set_id == "PROMO")
        """
        if set_id == "PROMO":
            return await self._get_promo_cards()
        if set_id.upper().startswith("ST"):
            return await self._get_starter_cards(set_id)
        return await self._get_set_cards(set_id)

    def get_image_url(self, card: CardData) -> str:
        """Build image URL from card ID."""
        if card.image_url and card.image_url.startswith("http"):
            return card.image_url
        return f"{IMAGE_BASE}/{card.id}.jpg"

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_set_cards(self, set_id: str) -> List[CardData]:
        data = await self._get_json(f"/api/sets/{set_id}/")
        cards = self._parse_card_list(data, set_id)
        logger.info("OPTCG API: set %s -> %d cards", set_id, len(cards))
        return cards

    async def _get_starter_cards(self, set_id: str) -> List[CardData]:
        data = await self._get_json("/api/allSTCards/")
        all_cards = self._parse_card_list(data, set_id)
        # Filter to the requested starter set
        cards = [c for c in all_cards if self._normalize_set_id(c.id).upper().startswith(set_id.upper())]
        logger.info("OPTCG API: starter %s -> %d cards", set_id, len(cards))
        return cards

    async def _get_promo_cards(self) -> List[CardData]:
        data = await self._get_json("/api/allPromoCards/")
        cards = self._parse_card_list(data, "PROMO")
        logger.info("OPTCG API: promos -> %d cards", len(cards))
        return cards

    def _parse_card_list(self, data: Any, default_set_id: str) -> List[CardData]:
        """Parse a list of raw card dicts into CardData objects."""
        if isinstance(data, dict):
            # Some endpoints wrap results in a dict
            data = data.get("results", data.get("cards", [data]))
        if not isinstance(data, list):
            data = [data]

        cards: List[CardData] = []
        for raw in data:
            try:
                cards.append(self._parse_card(raw, default_set_id))
            except Exception:
                logger.warning("OPTCG API: failed to parse card: %s", raw.get("card_set_id", "?"))
        return cards

    def _parse_card(self, raw: Dict[str, Any], default_set_id: str) -> CardData:
        card_id = str(raw.get("card_set_id", raw.get("id", "")))
        color_raw = str(raw.get("card_color", raw.get("color", "")))
        colors = [c.strip() for c in color_raw.split("/") if c.strip()] if color_raw else []

        traits_raw = raw.get("sub_types", raw.get("traits", ""))
        if isinstance(traits_raw, str):
            traits = [t.strip() for t in traits_raw.split("/") if t.strip()]
        elif isinstance(traits_raw, list):
            traits = traits_raw
        else:
            traits = []

        image_url = str(raw.get("card_image", ""))
        if image_url and not image_url.startswith("http"):
            image_url = f"{BASE_URL}{image_url}" if image_url.startswith("/") else f"{IMAGE_BASE}/{image_url}"

        return CardData(
            id=card_id,
            name=str(raw.get("card_name", raw.get("name", ""))),
            card_type=str(raw.get("card_type", raw.get("type", ""))).lower(),
            cost=_int_or_none(raw.get("card_cost", raw.get("cost"))),
            power=_int_or_none(raw.get("card_power", raw.get("power"))),
            counter=_int_or_none(raw.get("counter_amount", raw.get("counter"))),
            colors=colors,
            rarity=str(raw.get("rarity", "")),
            traits=traits,
            text=str(raw.get("card_text", raw.get("text", ""))),
            life=_int_or_none(raw.get("life")),
            image_url=image_url,
            set_id=default_set_id,
            source=self.name,
        )

    @staticmethod
    def _normalize_set_id(card_id: str) -> str:
        """Extract set prefix from a card ID like 'OP01-001' -> 'OP01'."""
        parts = card_id.split("-")
        return parts[0] if parts else card_id


def _int_or_none(val: Any) -> Optional[int]:
    if val is None or val == "" or val == "null":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None
