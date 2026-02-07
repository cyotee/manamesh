"""ManaMesh-compatible manifest generator.

Generates root and per-set manifest.json files matching the
AssetPackManifest / CardManifestEntry / SetReference types
from packages/frontend/src/assets/manifest/types.ts.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from onepiece_scraper.models import CardData, SetInfo

logger = logging.getLogger(__name__)


def generate_root_manifest(
    output_dir: str,
    sets: List[SetInfo],
    version: str = "1.0.0",
) -> Dict[str, Any]:
    """Generate the root manifest.json with SetReference entries."""
    manifest: Dict[str, Any] = {
        "name": "One Piece TCG - Complete",
        "version": version,
        "game": "onepiece",
        "sets": [
            {"name": s.name, "path": s.id}
            for s in sets
        ],
    }

    out_path = Path(output_dir) / "manifest.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Wrote root manifest: %s (%d sets)", out_path, len(sets))
    return manifest


def generate_set_manifest(
    output_dir: str,
    set_info: SetInfo,
    cards: List[CardData],
    version: str = "1.0.0",
) -> Dict[str, Any]:
    """Generate a per-set manifest.json with CardManifestEntry items."""
    card_entries = []
    for card in cards:
        entry: Dict[str, Any] = {
            "id": card.id,
            "name": card.name,
            "front": f"cards/{card.id}.{_guess_ext(card.image_url)}",
            "metadata": _build_metadata(card),
        }
        card_entries.append(entry)

    manifest: Dict[str, Any] = {
        "name": f"One Piece TCG - {set_info.name}",
        "version": version,
        "game": "onepiece",
        "cards": card_entries,
    }

    out_path = Path(output_dir) / set_info.id / "manifest.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Wrote set manifest: %s (%d cards)", out_path, len(cards))
    return manifest


def validate_manifest(manifest: Dict[str, Any]) -> List[str]:
    """Validate a manifest dict against the expected schema.

    Returns a list of error strings (empty = valid).
    """
    errors: List[str] = []

    for required in ("name", "version", "game"):
        if required not in manifest:
            errors.append(f"Missing required field: {required}")

    if manifest.get("game") != "onepiece":
        errors.append(f"Expected game='onepiece', got '{manifest.get('game')}'")

    if "cards" in manifest:
        seen_ids: set = set()
        for i, card in enumerate(manifest["cards"]):
            prefix = f"cards[{i}]"
            if "id" not in card:
                errors.append(f"{prefix}: missing 'id'")
            elif card["id"] in seen_ids:
                errors.append(f"{prefix}: duplicate id '{card['id']}'")
            else:
                seen_ids.add(card["id"])
            if "name" not in card:
                errors.append(f"{prefix}: missing 'name'")
            if "front" not in card:
                errors.append(f"{prefix}: missing 'front'")

    if "sets" in manifest:
        for i, s in enumerate(manifest["sets"]):
            prefix = f"sets[{i}]"
            if "name" not in s:
                errors.append(f"{prefix}: missing 'name'")
            if "path" not in s:
                errors.append(f"{prefix}: missing 'path'")

    return errors


def _build_metadata(card: CardData) -> Dict[str, Any]:
    """Build the metadata dict for a CardManifestEntry."""
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


def _guess_ext(image_url: str) -> str:
    """Guess the file extension from an image URL."""
    if not image_url:
        return "jpg"
    path = image_url.split("?")[0].split("#")[0]
    if "." in path.split("/")[-1]:
        ext = path.rsplit(".", 1)[-1].lower()
        if ext in ("jpg", "jpeg", "png", "webp", "gif"):
            return ext
    return "jpg"
