"""Scryfall Bulk Data adapter — primary MTG data source.

Downloads the ~501 MB Default Cards bulk file from Scryfall and parses
it locally. No rate limiting needed for bulk data access.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from card_scraper.games.mtg.models import MTGCardData
from card_scraper.games.mtg.type_parser import parse_type_line
from card_scraper.games.mtg.manifest_template import map_set_type_to_category
from card_scraper.models import SetInfo

logger = logging.getLogger(__name__)

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"


class ScryfallBulkAdapter:
    """Primary MTG adapter using Scryfall bulk data downloads.

    Downloads the Default Cards JSON (~501 MB) and caches it locally.
    Re-downloads if the cache is older than `bulk_ttl_hours`.
    """

    def __init__(
        self,
        bulk_ttl_hours: int = 24,
        image_size: str = "normal",
        cache_dir: str = "./data/scryfall/",
    ) -> None:
        self._bulk_ttl = bulk_ttl_hours * 3600  # Convert to seconds
        self._image_size = image_size
        self._cache_dir = Path(cache_dir)
        self._bulk_file = self._cache_dir / "default-cards.json"
        self._cards_cache: Optional[List[Dict[str, Any]]] = None
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def name(self) -> str:
        return "scryfall-bulk"

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=300.0,  # 5 minutes for large bulk download
                follow_redirects=True,
                headers={"User-Agent": "ManaMesh-CardScraper/0.2"},
            )
        return self._client

    async def _ensure_bulk_data(self) -> None:
        """Download bulk data if missing or stale."""
        if self._bulk_file.exists():
            age = time.time() - self._bulk_file.stat().st_mtime
            if age < self._bulk_ttl:
                logger.info("Bulk data cache is fresh (%.1f hours old)", age / 3600)
                return
            logger.info("Bulk data cache is stale (%.1f hours old), re-downloading", age / 3600)

        logger.info("Fetching bulk data download URL from Scryfall...")
        client = self._get_client()
        resp = await client.get(BULK_DATA_URL)
        resp.raise_for_status()
        bulk_meta = resp.json()

        # Find the "default_cards" entry
        download_url = None
        for entry in bulk_meta.get("data", []):
            if entry.get("type") == "default_cards":
                download_url = entry.get("download_uri")
                break

        if not download_url:
            raise RuntimeError("Could not find default_cards bulk data entry from Scryfall")

        logger.info("Downloading bulk data from %s ...", download_url)
        self._cache_dir.mkdir(parents=True, exist_ok=True)

        # Stream download to avoid loading entire file into memory
        async with client.stream("GET", download_url) as stream:
            stream.raise_for_status()
            with open(self._bulk_file, "wb") as f:
                async for chunk in stream.aiter_bytes(chunk_size=65536):
                    f.write(chunk)

        size_mb = self._bulk_file.stat().st_size / (1024 * 1024)
        logger.info("Bulk data downloaded: %.1f MB", size_mb)

    def _load_bulk_data(self) -> List[Dict[str, Any]]:
        """Load and cache the bulk JSON data."""
        if self._cards_cache is not None:
            return self._cards_cache

        logger.info("Loading bulk data from %s ...", self._bulk_file)
        with open(self._bulk_file, "r", encoding="utf-8") as f:
            self._cards_cache = json.load(f)
        logger.info("Loaded %d cards from bulk data", len(self._cards_cache))
        return self._cards_cache

    async def list_sets(self) -> List[SetInfo]:
        """Extract unique sets from bulk data."""
        await self._ensure_bulk_data()
        cards = self._load_bulk_data()

        seen: Dict[str, SetInfo] = {}
        for card in cards:
            set_code = card.get("set", "")
            if set_code and set_code not in seen:
                seen[set_code] = SetInfo(
                    id=set_code.upper(),
                    name=card.get("set_name", set_code),
                    category=map_set_type_to_category(card.get("set_type", "")),
                )

        sets = sorted(seen.values(), key=lambda s: s.id)
        logger.info("Scryfall Bulk: found %d sets", len(sets))
        return sets

    async def get_cards(self, set_id: str) -> List[MTGCardData]:
        """Filter bulk data for cards in the given set."""
        await self._ensure_bulk_data()
        all_cards = self._load_bulk_data()

        set_lower = set_id.lower()
        cards: List[MTGCardData] = []
        for raw in all_cards:
            if raw.get("set", "").lower() == set_lower:
                try:
                    cards.append(_parse_scryfall_card(raw, set_id, self._image_size))
                except Exception as exc:
                    logger.warning(
                        "Scryfall Bulk: failed to parse card %s: %s",
                        raw.get("name", "?"), exc,
                    )

        logger.info("Scryfall Bulk: set %s -> %d cards", set_id, len(cards))
        return cards

    def get_image_url(self, card: MTGCardData) -> str:
        """Return the image URL for the configured size."""
        return card.image_url

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()


def _parse_scryfall_card(
    raw: Dict[str, Any], set_id: str, image_size: str = "normal"
) -> MTGCardData:
    """Parse a Scryfall card object into MTGCardData."""
    # Parse type line
    type_line = raw.get("type_line", "")
    parsed = parse_type_line(type_line)

    # Get image URL (may be in top-level or in card_faces[0])
    image_url = ""
    image_uris = raw.get("image_uris")
    if image_uris:
        image_url = image_uris.get(image_size, image_uris.get("normal", ""))
    elif raw.get("card_faces"):
        face_uris = raw["card_faces"][0].get("image_uris", {})
        image_url = face_uris.get(image_size, face_uris.get("normal", ""))

    # Parse card faces for multi-face cards
    card_faces = None
    if raw.get("card_faces"):
        card_faces = []
        for face in raw["card_faces"]:
            face_type = parse_type_line(face.get("type_line", ""))
            face_data = {
                "name": face.get("name", ""),
                "mana_cost": face.get("mana_cost"),
                "oracle_text": face.get("oracle_text", ""),
                "type_line": face.get("type_line", ""),
                "types": face_type.types,
                "subtypes": face_type.subtypes,
                "supertypes": face_type.supertypes,
                "power": face.get("power"),
                "toughness": face.get("toughness"),
                "loyalty": face.get("loyalty"),
            }
            face_image_uris = face.get("image_uris", {})
            if face_image_uris:
                face_data["image_url"] = face_image_uris.get(
                    image_size, face_image_uris.get("normal", "")
                )
            card_faces.append(face_data)

    return MTGCardData(
        id=raw.get("id", ""),
        name=raw.get("name", ""),
        image_url=image_url,
        set_id=set_id,
        source="scryfall-bulk",
        rarity=raw.get("rarity", ""),
        mana_cost=raw.get("mana_cost"),
        cmc=float(raw.get("cmc", 0)),
        types=parsed.types,
        subtypes=parsed.subtypes,
        supertypes=parsed.supertypes,
        power=raw.get("power"),
        toughness=raw.get("toughness"),
        loyalty=raw.get("loyalty"),
        oracle_text=raw.get("oracle_text", ""),
        colors=raw.get("colors", []),
        color_identity=raw.get("color_identity", []),
        layout=raw.get("layout", "normal"),
        card_faces=card_faces,
        keywords=raw.get("keywords", []),
        collector_number=raw.get("collector_number", ""),
    )
