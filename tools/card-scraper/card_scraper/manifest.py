"""Base manifest generation and validation utilities.

Game-specific manifest templates live in their respective
game packages (games/onepiece/manifest_template.py, etc.).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from card_scraper.models import CardDataBase, SetInfo

logger = logging.getLogger(__name__)


def write_manifest(path: Path, manifest: Dict[str, Any]) -> None:
    """Write a manifest dict to a JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def generate_root_manifest(
    output_dir: str,
    game: str,
    game_display_name: str,
    sets: List[SetInfo],
    version: str = "1.0.0",
) -> Dict[str, Any]:
    """Generate the root manifest.json with SetReference entries."""
    manifest: Dict[str, Any] = {
        "name": f"{game_display_name} - Complete",
        "version": version,
        "game": game,
        "sets": [
            {"name": s.name, "path": s.id}
            for s in sets
        ],
    }

    out_path = Path(output_dir) / "manifest.json"
    write_manifest(out_path, manifest)
    logger.info("Wrote root manifest: %s (%d sets)", out_path, len(sets))
    return manifest


def validate_manifest(manifest: Dict[str, Any], expected_game: str | None = None) -> List[str]:
    """Validate a manifest dict against the expected schema.

    Returns a list of error strings (empty = valid).
    """
    errors: List[str] = []

    for required in ("name", "version", "game"):
        if required not in manifest:
            errors.append(f"Missing required field: {required}")

    if expected_game and manifest.get("game") != expected_game:
        errors.append(f"Expected game='{expected_game}', got '{manifest.get('game')}'")

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


def guess_ext(image_url: str) -> str:
    """Guess the file extension from an image URL."""
    if not image_url:
        return "jpg"
    path = image_url.split("?")[0].split("#")[0]
    if "." in path.split("/")[-1]:
        ext = path.rsplit(".", 1)[-1].lower()
        if ext in ("jpg", "jpeg", "png", "webp", "gif"):
            return ext
    return "jpg"
