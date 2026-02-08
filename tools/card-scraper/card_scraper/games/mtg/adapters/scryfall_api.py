"""Scryfall REST API adapter — for incremental updates and single-card lookups.

Respects Scryfall's rate limit of 10 requests per second (configurable).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

from card_scraper.games.mtg.models import MTGCardData
from card_scraper.games.mtg.type_parser import parse_type_line
from card_scraper.games.mtg.manifest_template import map_set_type_to_category
from card_scraper.models import SetInfo

logger = logging.getLogger(__name__)

BASE_URL = "https://api.scryfall.com"


class ScryfallApiAdapter:
    """MTG adapter using the Scryfall REST API.

    Use for incremental updates and single-set imports. The bulk adapter
    is preferred for full database imports.
    """

    def __init__(
        self,
        rate_limit_ms: int = 100,
        image_size: str = "normal",
    ) -> None:
        self._rate_limit = rate_limit_ms / 1000.0
        self._image_size = image_size
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def name(self) -> str:
        return "scryfall-api"

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=BASE_URL,
                timeout=30.0,
                headers={"User-Agent": "ManaMesh-CardScraper/0.2"},
            )
        return self._client

    async def _throttle(self) -> None:
        if self._rate_limit > 0:
            await asyncio.sleep(self._rate_limit)

    async def _get_json(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        client = self._get_client()
        await self._throttle()
        for attempt in range(3):
            try:
                resp = await client.get(path, params=params)
                if resp.status_code == 429:
                    # Rate limited: exponential backoff
                    delay = (2 ** attempt) * 1.0
                    logger.warning("Rate limited, backing off %.1fs", delay)
                    await asyncio.sleep(delay)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError:
                raise
            except Exception as exc:
                if attempt < 2:
                    await asyncio.sleep(1.0)
                    continue
                raise
        raise RuntimeError("Max retries exceeded for Scryfall API request")

    async def list_sets(self) -> List[SetInfo]:
        """Fetch all sets from GET /sets."""
        data = await self._get_json("/sets")
        sets: List[SetInfo] = []
        for item in data.get("data", []):
            sets.append(
                SetInfo(
                    id=item.get("code", "").upper(),
                    name=item.get("name", ""),
                    category=map_set_type_to_category(item.get("set_type", "")),
                )
            )
        logger.info("Scryfall API: found %d sets", len(sets))
        return sets

    async def get_cards(self, set_id: str) -> List[MTGCardData]:
        """Fetch all cards for a set using search with pagination."""
        from urllib.parse import urlparse, parse_qs

        all_cards: List[MTGCardData] = []
        set_lower = set_id.lower()

        path: Optional[str] = "/cards/search"
        params: Optional[Dict[str, Any]] = {"q": f"set:{set_lower}", "unique": "prints"}

        while path is not None:
            data = await self._get_json(path, params=params)
            for raw in data.get("data", []):
                try:
                    all_cards.append(
                        _parse_scryfall_card(raw, set_id, self._image_size)
                    )
                except Exception as exc:
                    logger.warning(
                        "Scryfall API: failed to parse card %s: %s",
                        raw.get("name", "?"), exc,
                    )

            if data.get("has_more"):
                next_url = data.get("next_page", "")
                if next_url:
                    parsed = urlparse(next_url)
                    path = parsed.path
                    params = (
                        {k: v[0] for k, v in parse_qs(parsed.query).items()}
                        if parsed.query
                        else None
                    )
                else:
                    path = None
                    params = None
            else:
                path = None
                params = None

        logger.info("Scryfall API: set %s -> %d cards", set_id, len(all_cards))
        return all_cards

    def get_image_url(self, card: MTGCardData) -> str:
        return card.image_url

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()


def _parse_scryfall_card(
    raw: Dict[str, Any], set_id: str, image_size: str = "normal"
) -> MTGCardData:
    """Parse a Scryfall card object into MTGCardData.

    Shared with the bulk adapter — identical parsing logic.
    """
    from card_scraper.games.mtg.adapters.scryfall_bulk import _parse_scryfall_card as bulk_parse
    return bulk_parse(raw, set_id, image_size)
