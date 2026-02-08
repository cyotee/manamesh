"""One Piece TCG manifest generation."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from card_scraper.games.onepiece.models import OnePieceCardData
from card_scraper.manifest import generate_root_manifest, guess_ext, write_manifest
from card_scraper.models import SetInfo

from pathlib import Path

logger = logging.getLogger(__name__)


def generate_onepiece_root_manifest(
    output_dir: str,
    sets: List[SetInfo],
    version: str = "1.0.0",
) -> Dict[str, Any]:
    """Generate the root manifest for One Piece TCG."""
    return generate_root_manifest(
        output_dir=output_dir,
        game="onepiece",
        game_display_name="One Piece TCG",
        sets=sets,
        version=version,
    )


def generate_onepiece_set_manifest(
    output_dir: str,
    set_info: SetInfo,
    cards: List[OnePieceCardData],
    version: str = "1.0.0",
) -> Dict[str, Any]:
    """Generate a per-set manifest for One Piece TCG."""
    card_entries = []
    for card in cards:
        entry: Dict[str, Any] = {
            "id": card.id,
            "name": card.name,
            "front": f"cards/{card.id}.{guess_ext(card.image_url)}",
            "metadata": _build_onepiece_metadata(card),
        }
        card_entries.append(entry)

    manifest: Dict[str, Any] = {
        "name": f"One Piece TCG - {set_info.name}",
        "version": version,
        "game": "onepiece",
        "cards": card_entries,
    }

    out_path = Path(output_dir) / set_info.id / "manifest.json"
    write_manifest(out_path, manifest)
    logger.info("Wrote set manifest: %s (%d cards)", out_path, len(cards))
    return manifest


def _build_onepiece_metadata(card: OnePieceCardData) -> Dict[str, Any]:
    """Build the metadata dict for a One Piece card manifest entry."""
    meta: Dict[str, Any] = {
        "cardType": card.card_type,
    }
    if card.cost is not None:
        meta["cost"] = card.cost
    if card.power is not None:
        meta["power"] = card.power
    if card.colors:
        meta["colors"] = card.colors
    if card.rarity:
        meta["rarity"] = card.rarity
    if card.traits:
        meta["traits"] = card.traits
    if card.text:
        meta["text"] = card.text
    if card.counter is not None:
        meta["counter"] = card.counter
    if card.life is not None:
        meta["life"] = card.life
    return meta
