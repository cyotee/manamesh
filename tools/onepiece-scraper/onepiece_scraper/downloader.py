"""Image downloader with retry, concurrency, and progress tracking."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import List, Optional, Tuple

import httpx

from onepiece_scraper.models import CardData

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
BACKOFF_BASE = 1.0  # seconds — exponential backoff: 1, 2, 4


class ImageDownloader:
    """Downloads card images concurrently with retry logic."""

    def __init__(
        self,
        output_dir: str,
        concurrency: int = 5,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self._output_dir = Path(output_dir)
        self._semaphore = asyncio.Semaphore(concurrency)
        self._max_retries = max_retries
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=60.0,
                follow_redirects=True,
                headers={"User-Agent": "ManaMesh-OnePieceScraper/0.1"},
            )
        return self._client

    def image_path(self, set_id: str, card_id: str, ext: str = "jpg") -> Path:
        """Return the local file path for a card image."""
        return self._output_dir / set_id / "cards" / f"{card_id}.{ext}"

    def image_exists(self, set_id: str, card_id: str, ext: str = "jpg") -> bool:
        return self.image_path(set_id, card_id, ext).exists()

    async def download_card_image(
        self, card: CardData, image_url: str
    ) -> Tuple[bool, Optional[str]]:
        """Download a single card image with retry.

        Returns (success, error_message).
        """
        if not image_url:
            return False, "No image URL"

        ext = _url_extension(image_url)
        dest = self.image_path(card.set_id, card.id, ext)

        if dest.exists():
            return True, None

        dest.parent.mkdir(parents=True, exist_ok=True)

        async with self._semaphore:
            for attempt in range(1, self._max_retries + 1):
                try:
                    client = self._get_client()
                    resp = await client.get(image_url)
                    resp.raise_for_status()
                    dest.write_bytes(resp.content)
                    return True, None
                except Exception as exc:
                    if attempt < self._max_retries:
                        delay = BACKOFF_BASE * (2 ** (attempt - 1))
                        logger.debug(
                            "Retry %d/%d for %s (%.1fs): %s",
                            attempt,
                            self._max_retries,
                            card.id,
                            delay,
                            exc,
                        )
                        await asyncio.sleep(delay)
                    else:
                        error = f"Failed after {self._max_retries} attempts: {exc}"
                        logger.warning("Download failed for %s: %s", card.id, error)
                        return False, error

        return False, "Unknown error"

    async def download_batch(
        self,
        cards: List[CardData],
        get_url: callable,
        progress_callback: Optional[callable] = None,
    ) -> Tuple[int, int]:
        """Download images for a batch of cards concurrently.

        Returns (success_count, failure_count).
        """
        tasks = []
        for card in cards:
            url = get_url(card)
            tasks.append(self._download_with_progress(card, url, progress_callback))

        results = await asyncio.gather(*tasks)
        successes = sum(1 for ok, _ in results if ok)
        failures = len(results) - successes
        return successes, failures

    async def _download_with_progress(
        self,
        card: CardData,
        image_url: str,
        progress_callback: Optional[callable],
    ) -> Tuple[bool, Optional[str]]:
        result = await self.download_card_image(card, image_url)
        if progress_callback:
            progress_callback()
        return result

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()


def _url_extension(url: str) -> str:
    """Extract file extension from a URL, defaulting to jpg."""
    path = url.split("?")[0].split("#")[0]
    if "." in path.split("/")[-1]:
        ext = path.rsplit(".", 1)[-1].lower()
        if ext in ("jpg", "jpeg", "png", "webp", "gif"):
            return ext
    return "jpg"
