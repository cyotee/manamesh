"""Incremental state tracker — persists scrape progress to JSON."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from card_scraper.models import CardImageStatus, ScrapeState, SetScrapeState

logger = logging.getLogger(__name__)


class StateTracker:
    """Manages incremental scrape state backed by a JSON file."""

    def __init__(self, state_file: str) -> None:
        self._path = Path(state_file)
        self._state: Optional[ScrapeState] = None

    @property
    def state(self) -> ScrapeState:
        if self._state is None:
            self._state = self._load()
        return self._state

    def reset(self) -> None:
        """Clear all state (for --force mode)."""
        self._state = ScrapeState()

    def save(self) -> None:
        """Persist current state to disk."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = _serialize_state(self.state)
        self._path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.debug("State saved to %s", self._path)

    def delete(self) -> None:
        """Remove the state file."""
        if self._path.exists():
            self._path.unlink()
            logger.info("Deleted state file %s", self._path)
        self._state = ScrapeState()

    def summary(self) -> Dict[str, Any]:
        """Return a human-readable summary of current state."""
        st = self.state
        total_cards = sum(len(ss.card_ids) for ss in st.sets.values())
        total_images = sum(
            1
            for ss in st.sets.values()
            for img in ss.images.values()
            if img.status == "success"
        )
        failed_images = sum(
            1
            for ss in st.sets.values()
            for img in ss.images.values()
            if img.status == "failed"
        )
        return {
            "sets_scraped": len(st.sets),
            "total_cards": total_cards,
            "images_downloaded": total_images,
            "images_failed": failed_images,
            "sets": {
                sid: {
                    "cards": len(ss.card_ids),
                    "images_ok": sum(1 for i in ss.images.values() if i.status == "success"),
                    "images_failed": sum(1 for i in ss.images.values() if i.status == "failed"),
                    "last_scraped": ss.last_scraped,
                }
                for sid, ss in st.sets.items()
            },
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _load(self) -> ScrapeState:
        if not self._path.exists():
            logger.info("No state file at %s, starting fresh", self._path)
            return ScrapeState()

        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            return _deserialize_state(raw)
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            logger.warning("Corrupt state file %s: %s — starting fresh", self._path, exc)
            return ScrapeState()


def _serialize_state(state: ScrapeState) -> Dict[str, Any]:
    return {
        "sets": {
            sid: {
                "set_id": ss.set_id,
                "last_scraped": ss.last_scraped,
                "card_ids": ss.card_ids,
                "images": {
                    cid: {
                        "card_id": img.card_id,
                        "status": img.status,
                        "path": img.path,
                        "error": img.error,
                    }
                    for cid, img in ss.images.items()
                },
            }
            for sid, ss in state.sets.items()
        }
    }


def _deserialize_state(raw: Dict[str, Any]) -> ScrapeState:
    state = ScrapeState()
    for sid, ss_raw in raw.get("sets", {}).items():
        images: Dict[str, CardImageStatus] = {}
        for cid, img_raw in ss_raw.get("images", {}).items():
            images[cid] = CardImageStatus(
                card_id=img_raw["card_id"],
                status=img_raw["status"],
                path=img_raw.get("path"),
                error=img_raw.get("error"),
            )
        state.sets[sid] = SetScrapeState(
            set_id=ss_raw.get("set_id", sid),
            last_scraped=ss_raw.get("last_scraped"),
            card_ids=ss_raw.get("card_ids", []),
            images=images,
        )
    return state
