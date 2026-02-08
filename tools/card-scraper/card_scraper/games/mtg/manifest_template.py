"""MTG manifest generation.

Generates ManaMesh-compatible manifests with MTG-specific metadata
including mana cost, types, power/toughness, colors, and multi-face support.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List

from card_scraper.games.mtg.models import MTGCardData
from card_scraper.manifest import generate_root_manifest, write_manifest
from card_scraper.models import SetInfo

logger = logging.getLogger(__name__)

# Scryfall set_type -> ManaMesh category mapping
SET_TYPE_TO_CATEGORY = {
    "core": "core",
    "expansion": "expansion",
    "commander": "commander",
    "masters": "masters",
    "draft_innovation": "supplemental",
    "funny": "supplemental",
    "starter": "core",
    "box": "supplemental",
    "promo": "promo",
    "token": "token",
    "memorabilia": "promo",
    "treasure_chest": "supplemental",
    "alchemy": "supplemental",
    "arsenal": "supplemental",
    "from_the_vault": "supplemental",
    "spellbook": "supplemental",
    "premium_deck": "supplemental",
    "duel_deck": "supplemental",
    "planechase": "supplemental",
    "archenemy": "supplemental",
    "vanguard": "supplemental",
    "minigame": "supplemental",
}


def generate_mtg_root_manifest(
    output_dir: str,
    sets: List[SetInfo],
    version: str = "1.0.0",
) -> Dict[str, Any]:
    """Generate the root manifest for MTG."""
    return generate_root_manifest(
        output_dir=output_dir,
        game="mtg",
        game_display_name="Magic: The Gathering",
        sets=sets,
        version=version,
    )


def generate_mtg_set_manifest(
    output_dir: str,
    set_info: SetInfo,
    cards: List[MTGCardData],
    version: str = "1.0.0",
) -> Dict[str, Any]:
    """Generate a per-set manifest for MTG."""
    card_entries = []
    for card in cards:
        entry = _build_card_entry(card, set_info.id)
        card_entries.append(entry)

    manifest: Dict[str, Any] = {
        "name": f"Magic: The Gathering - {set_info.name}",
        "version": version,
        "game": "mtg",
        "cards": card_entries,
    }

    out_path = Path(output_dir) / set_info.id / "manifest.json"
    write_manifest(out_path, manifest)
    logger.info("Wrote MTG set manifest: %s (%d cards)", out_path, len(cards))
    return manifest


def _build_card_entry(card: MTGCardData, set_code: str) -> Dict[str, Any]:
    """Build a card manifest entry with MTG metadata."""
    collector_num = card.collector_number or card.id
    ext = "jpg"  # Scryfall serves jpg by default for normal/large

    # Multi-face cards get front/back images
    is_multi_face = card.layout in (
        "transform", "modal_dfc", "reversible_card", "art_series",
    )

    entry: Dict[str, Any] = {
        "id": card.id,
        "name": card.name,
        "front": f"cards/{set_code}-{collector_num}.{ext}",
    }

    if is_multi_face:
        entry["front"] = f"cards/{set_code}-{collector_num}-front.{ext}"
        entry["back"] = f"cards/{set_code}-{collector_num}-back.{ext}"

    entry["metadata"] = _build_mtg_metadata(card)
    return entry


def _build_mtg_metadata(card: MTGCardData) -> Dict[str, Any]:
    """Build the metadata dict for an MTG card manifest entry."""
    meta: Dict[str, Any] = {}

    if card.mana_cost:
        meta["manaCost"] = card.mana_cost
    meta["cmc"] = card.cmc

    if card.types:
        meta["types"] = card.types
    if card.subtypes:
        meta["subtypes"] = card.subtypes
    if card.supertypes:
        meta["supertypes"] = card.supertypes

    if card.power is not None:
        meta["power"] = card.power
    if card.toughness is not None:
        meta["toughness"] = card.toughness
    if card.loyalty is not None:
        meta["loyalty"] = card.loyalty

    if card.colors:
        meta["colors"] = card.colors
    if card.color_identity:
        meta["colorIdentity"] = card.color_identity
    if card.rarity:
        meta["rarity"] = card.rarity
    if card.keywords:
        meta["keywords"] = card.keywords
    if card.layout != "normal":
        meta["layout"] = card.layout
    if card.oracle_text:
        meta["oracleText"] = card.oracle_text

    if card.card_faces:
        meta["faces"] = card.card_faces

    return meta


def map_set_type_to_category(set_type: str) -> str:
    """Map a Scryfall set_type to a ManaMesh category."""
    return SET_TYPE_TO_CATEGORY.get(set_type, "supplemental")
