"""Tests for MTG manifest generation."""

from card_scraper.games.mtg.manifest_template import (
    generate_mtg_root_manifest,
    generate_mtg_set_manifest,
    map_set_type_to_category,
    _build_mtg_metadata,
)
from card_scraper.games.mtg.models import MTGCardData
from card_scraper.models import SetInfo


def test_generate_mtg_root_manifest(tmp_path):
    sets = [
        SetInfo(id="MKM", name="Murders at Karlov Manor", category="expansion"),
        SetInfo(id="LCI", name="Lost Caverns of Ixalan", category="expansion"),
    ]
    manifest = generate_mtg_root_manifest(str(tmp_path), sets)
    assert manifest["game"] == "mtg"
    assert manifest["name"] == "Magic: The Gathering - Complete"
    assert len(manifest["sets"]) == 2


def test_generate_mtg_set_manifest(tmp_path):
    set_info = SetInfo(id="MKM", name="Murders at Karlov Manor", category="expansion")
    cards = [
        MTGCardData(
            id="card-001",
            name="Detective of the Month",
            image_url="https://example.com/card.jpg",
            set_id="MKM",
            source="scryfall-bulk",
            rarity="uncommon",
            mana_cost="{2}{W}",
            cmc=3.0,
            types=["Creature"],
            subtypes=["Human", "Detective"],
            supertypes=[],
            power="2",
            toughness="3",
            colors=["W"],
            color_identity=["W"],
            collector_number="1",
            keywords=["Vigilance"],
        ),
    ]
    manifest = generate_mtg_set_manifest(str(tmp_path), set_info, cards)
    assert manifest["game"] == "mtg"
    assert len(manifest["cards"]) == 1
    entry = manifest["cards"][0]
    assert entry["front"] == "cards/MKM-1.jpg"
    assert entry["metadata"]["manaCost"] == "{2}{W}"
    assert entry["metadata"]["types"] == ["Creature"]


def test_mtg_manifest_multi_face(tmp_path):
    set_info = SetInfo(id="ISD", name="Innistrad", category="expansion")
    cards = [
        MTGCardData(
            id="dfc-001",
            name="Delver of Secrets // Insectile Aberration",
            image_url="https://example.com/front.jpg",
            set_id="ISD",
            source="scryfall-bulk",
            rarity="common",
            layout="transform",
            types=["Creature"],
            collector_number="51",
            card_faces=[
                {"name": "Delver of Secrets", "type_line": "Creature \u2014 Human Wizard"},
                {"name": "Insectile Aberration", "type_line": "Creature \u2014 Human Insect"},
            ],
        ),
    ]
    manifest = generate_mtg_set_manifest(str(tmp_path), set_info, cards)
    entry = manifest["cards"][0]
    assert entry["front"] == "cards/ISD-51-front.jpg"
    assert entry["back"] == "cards/ISD-51-back.jpg"
    assert entry["metadata"]["layout"] == "transform"


def test_build_mtg_metadata():
    card = MTGCardData(
        id="test", name="Test", image_url="", set_id="T", source="test",
        mana_cost="{1}{R}",
        cmc=2.0,
        types=["Instant"],
        colors=["R"],
        color_identity=["R"],
        oracle_text="Deal 3 damage.",
        rarity="common",
    )
    meta = _build_mtg_metadata(card)
    assert meta["manaCost"] == "{1}{R}"
    assert meta["cmc"] == 2.0
    assert meta["types"] == ["Instant"]
    assert meta["oracleText"] == "Deal 3 damage."


def test_build_mtg_metadata_planeswalker():
    card = MTGCardData(
        id="pw", name="Jace", image_url="", set_id="T", source="test",
        loyalty="3",
        types=["Planeswalker"],
        supertypes=["Legendary"],
        subtypes=["Jace"],
    )
    meta = _build_mtg_metadata(card)
    assert meta["loyalty"] == "3"
    assert meta["supertypes"] == ["Legendary"]


def test_map_set_type_to_category():
    assert map_set_type_to_category("core") == "core"
    assert map_set_type_to_category("expansion") == "expansion"
    assert map_set_type_to_category("commander") == "commander"
    assert map_set_type_to_category("masters") == "masters"
    assert map_set_type_to_category("promo") == "promo"
    assert map_set_type_to_category("token") == "token"
    assert map_set_type_to_category("unknown_type") == "supplemental"
