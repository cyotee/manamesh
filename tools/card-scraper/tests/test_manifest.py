"""Tests for manifest generation and validation."""

import json

from card_scraper.manifest import generate_root_manifest, validate_manifest
from card_scraper.games.onepiece.manifest_template import (
    generate_onepiece_root_manifest,
    generate_onepiece_set_manifest,
)
from card_scraper.games.onepiece.models import OnePieceCardData
from card_scraper.models import SetInfo


def test_generate_root_manifest(tmp_path):
    sets = [
        SetInfo(id="OP-01", name="Romance Dawn", category="booster"),
        SetInfo(id="OP-02", name="Paramount War", category="booster"),
    ]
    manifest = generate_onepiece_root_manifest(str(tmp_path), sets)
    assert manifest["game"] == "onepiece"
    assert manifest["name"] == "One Piece TCG - Complete"
    assert len(manifest["sets"]) == 2
    assert (tmp_path / "manifest.json").exists()


def test_generate_set_manifest(tmp_path):
    set_info = SetInfo(id="OP-01", name="Romance Dawn", category="booster")
    cards = [
        OnePieceCardData(
            id="OP01-001",
            name="Roronoa Zoro",
            card_type="character",
            cost=3,
            power=5000,
            counter=1000,
            colors=["Red"],
            rarity="SR",
            traits=["Supernovas", "Straw Hat Crew"],
            text="Rush",
            life=None,
            image_url="http://example.com/zoro.jpg",
            set_id="OP-01",
            source="optcg-api",
        ),
    ]
    manifest = generate_onepiece_set_manifest(str(tmp_path), set_info, cards)
    assert manifest["game"] == "onepiece"
    assert len(manifest["cards"]) == 1
    assert manifest["cards"][0]["id"] == "OP01-001"
    assert manifest["cards"][0]["metadata"]["cardType"] == "character"
    assert manifest["cards"][0]["metadata"]["power"] == 5000


def test_generate_set_manifest_leader(tmp_path):
    set_info = SetInfo(id="OP-01", name="Romance Dawn", category="booster")
    cards = [
        OnePieceCardData(
            id="OP01-L001",
            name="Monkey D. Luffy",
            card_type="leader",
            cost=None,
            power=5000,
            counter=None,
            colors=["Red"],
            rarity="L",
            traits=["Straw Hat Crew"],
            text="",
            life=5,
            image_url="http://example.com/luffy.jpg",
            set_id="OP-01",
            source="optcg-api",
        ),
    ]
    manifest = generate_onepiece_set_manifest(str(tmp_path), set_info, cards)
    meta = manifest["cards"][0]["metadata"]
    assert meta["life"] == 5
    assert "cost" not in meta


def test_validate_manifest_valid():
    manifest = {
        "name": "Test Pack",
        "version": "1.0",
        "game": "onepiece",
        "cards": [
            {"id": "C1", "name": "Card 1", "front": "cards/C1.jpg"},
        ],
    }
    errors = validate_manifest(manifest, expected_game="onepiece")
    assert errors == []


def test_validate_manifest_missing_fields():
    errors = validate_manifest({})
    assert len(errors) == 3  # name, version, game


def test_validate_manifest_wrong_game():
    manifest = {"name": "T", "version": "1.0", "game": "mtg"}
    errors = validate_manifest(manifest, expected_game="onepiece")
    assert any("Expected game" in e for e in errors)


def test_validate_manifest_no_expected_game():
    """When no expected_game, any game value is valid."""
    manifest = {"name": "T", "version": "1.0", "game": "mtg"}
    errors = validate_manifest(manifest)
    assert errors == []


def test_validate_manifest_duplicate_card_id():
    manifest = {
        "name": "T", "version": "1.0", "game": "onepiece",
        "cards": [
            {"id": "C1", "name": "Card 1", "front": "c1.jpg"},
            {"id": "C1", "name": "Card 1 Dupe", "front": "c1b.jpg"},
        ],
    }
    errors = validate_manifest(manifest)
    assert any("duplicate" in e for e in errors)


def test_validate_manifest_card_missing_id():
    manifest = {
        "name": "T", "version": "1.0", "game": "onepiece",
        "cards": [{"name": "No ID", "front": "x.jpg"}],
    }
    errors = validate_manifest(manifest)
    assert any("missing 'id'" in e for e in errors)


def test_validate_manifest_sets():
    manifest = {
        "name": "T", "version": "1.0", "game": "onepiece",
        "sets": [{"name": "Set 1", "path": "s1"}],
    }
    errors = validate_manifest(manifest)
    assert errors == []


def test_validate_manifest_sets_missing_fields():
    manifest = {
        "name": "T", "version": "1.0", "game": "onepiece",
        "sets": [{"name": "Set 1"}],
    }
    errors = validate_manifest(manifest)
    assert any("missing 'path'" in e for e in errors)
