"""Tests for manifest generation and validation."""

import json
from pathlib import Path

from onepiece_scraper.manifest import (
    generate_root_manifest,
    generate_set_manifest,
    validate_manifest,
)
from onepiece_scraper.models import CardData, SetInfo


def _make_card(card_id: str = "OP01-001", **overrides) -> CardData:
    defaults = dict(
        id=card_id,
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
        image_url="https://example.com/OP01-001.jpg",
        set_id="OP-01",
        source="optcg-api",
    )
    defaults.update(overrides)
    return CardData(**defaults)


def test_generate_root_manifest(tmp_path):
    sets = [
        SetInfo(id="OP-01", name="Romance Dawn", category="booster"),
        SetInfo(id="OP-02", name="Paramount War", category="booster"),
    ]
    result = generate_root_manifest(str(tmp_path), sets, version="1.0.0")

    assert result["name"] == "One Piece TCG - Complete"
    assert result["game"] == "onepiece"
    assert len(result["sets"]) == 2
    assert result["sets"][0]["name"] == "Romance Dawn"
    assert result["sets"][0]["path"] == "OP-01"

    # File was written
    manifest_path = tmp_path / "manifest.json"
    assert manifest_path.exists()
    data = json.loads(manifest_path.read_text())
    assert data == result


def test_generate_set_manifest(tmp_path):
    set_info = SetInfo(id="OP-01", name="Romance Dawn", category="booster")
    cards = [_make_card("OP01-001"), _make_card("OP01-002", name="Monkey D. Luffy")]

    result = generate_set_manifest(str(tmp_path), set_info, cards, version="1.0.0")

    assert result["name"] == "One Piece TCG - Romance Dawn"
    assert result["game"] == "onepiece"
    assert len(result["cards"]) == 2
    assert result["cards"][0]["id"] == "OP01-001"
    assert result["cards"][0]["front"] == "cards/OP01-001.jpg"
    assert result["cards"][0]["metadata"]["cardType"] == "character"
    assert result["cards"][0]["metadata"]["cost"] == 3
    assert result["cards"][0]["metadata"]["power"] == 5000
    assert result["cards"][0]["metadata"]["colors"] == ["Red"]
    assert result["cards"][0]["metadata"]["traits"] == ["Supernovas", "Straw Hat Crew"]
    assert result["cards"][0]["metadata"]["counter"] == 1000

    # File was written
    manifest_path = tmp_path / "OP-01" / "manifest.json"
    assert manifest_path.exists()


def test_generate_set_manifest_leader(tmp_path):
    """Leader cards should include life in metadata."""
    set_info = SetInfo(id="OP-01", name="Romance Dawn", category="booster")
    card = _make_card(
        "OP01-001",
        card_type="leader",
        life=5,
        cost=None,
        counter=None,
    )
    result = generate_set_manifest(str(tmp_path), set_info, [card])
    meta = result["cards"][0]["metadata"]
    assert meta["life"] == 5
    assert "cost" not in meta  # None fields excluded
    assert "counter" not in meta


def test_validate_manifest_valid():
    manifest = {
        "name": "Test",
        "version": "1.0.0",
        "game": "onepiece",
        "cards": [
            {"id": "OP01-001", "name": "Zoro", "front": "cards/OP01-001.jpg"},
        ],
    }
    errors = validate_manifest(manifest)
    assert errors == []


def test_validate_manifest_missing_fields():
    errors = validate_manifest({})
    assert len(errors) == 4  # name, version, game missing + game != onepiece


def test_validate_manifest_wrong_game():
    errors = validate_manifest({"name": "T", "version": "1.0", "game": "mtg"})
    assert any("onepiece" in e for e in errors)


def test_validate_manifest_duplicate_card_id():
    manifest = {
        "name": "T",
        "version": "1.0",
        "game": "onepiece",
        "cards": [
            {"id": "OP01-001", "name": "A", "front": "a.jpg"},
            {"id": "OP01-001", "name": "B", "front": "b.jpg"},
        ],
    }
    errors = validate_manifest(manifest)
    assert any("duplicate" in e for e in errors)


def test_validate_manifest_card_missing_id():
    manifest = {
        "name": "T",
        "version": "1.0",
        "game": "onepiece",
        "cards": [{"name": "A", "front": "a.jpg"}],
    }
    errors = validate_manifest(manifest)
    assert any("'id'" in e for e in errors)


def test_validate_manifest_sets():
    manifest = {
        "name": "T",
        "version": "1.0",
        "game": "onepiece",
        "sets": [
            {"name": "Romance Dawn", "path": "OP-01"},
            {"path": "OP-02"},  # missing name
        ],
    }
    errors = validate_manifest(manifest)
    assert any("'name'" in e for e in errors)
