"""Tests for the MTGJSON adapter."""

import json
import pytest

from card_scraper.games.mtg.adapters.mtgjson import MtgjsonAdapter, _parse_mtgjson_card


SAMPLE_SET_DATA = {
    "data": {
        "LEA": {
            "name": "Limited Edition Alpha",
            "type": "core",
            "cards": [
                {
                    "uuid": "mtgjson-bolt-001",
                    "name": "Lightning Bolt",
                    "manaCost": "{R}",
                    "manaValue": 1.0,
                    "types": ["Instant"],
                    "subtypes": [],
                    "supertypes": [],
                    "text": "Lightning Bolt deals 3 damage to any target.",
                    "colors": ["R"],
                    "colorIdentity": ["R"],
                    "keywords": [],
                    "number": "161",
                    "rarity": "common",
                    "layout": "normal",
                    "identifiers": {
                        "scryfallId": "f29ba16f",
                        "mtgoId": "12345",
                        "tcgplayerProductId": "67890",
                    },
                },
                {
                    "uuid": "mtgjson-tarm-001",
                    "name": "Tarmogoyf",
                    "manaCost": "{1}{G}",
                    "manaValue": 2.0,
                    "types": ["Creature"],
                    "subtypes": ["Lhurgoyf"],
                    "supertypes": [],
                    "power": "*",
                    "toughness": "1+*",
                    "text": "Tarmogoyf's power is equal to...",
                    "colors": ["G"],
                    "colorIdentity": ["G"],
                    "keywords": [],
                    "number": "153",
                    "rarity": "rare",
                    "layout": "normal",
                    "identifiers": {},
                },
            ],
        },
    }
}


@pytest.fixture
def adapter(tmp_path):
    data_file = tmp_path / "AllPrintings.json"
    data_file.write_text(json.dumps(SAMPLE_SET_DATA))
    return MtgjsonAdapter(local_path=str(data_file))


async def test_list_sets(adapter):
    sets = await adapter.list_sets()
    assert len(sets) == 1
    assert sets[0].id == "LEA"
    assert sets[0].name == "Limited Edition Alpha"


async def test_get_cards(adapter):
    cards = await adapter.get_cards("LEA")
    assert len(cards) == 2
    assert cards[0].name == "Lightning Bolt"
    assert cards[0].source == "mtgjson"


async def test_get_cards_missing_set(adapter):
    cards = await adapter.get_cards("NONEXISTENT")
    assert len(cards) == 0


async def test_cross_ref_ids(adapter):
    cards = await adapter.get_cards("LEA")
    bolt = cards[0]
    assert bolt.cross_ref_ids["scryfallId"] == "f29ba16f"
    assert bolt.cross_ref_ids["mtgoId"] == "12345"
    assert bolt.cross_ref_ids["tcgplayerProductId"] == "67890"


async def test_star_power_toughness(adapter):
    cards = await adapter.get_cards("LEA")
    tarm = cards[1]
    assert tarm.power == "*"
    assert tarm.toughness == "1+*"


async def test_no_image_url(adapter):
    """MTGJSON doesn't provide images."""
    cards = await adapter.get_cards("LEA")
    assert cards[0].image_url == ""


def test_adapter_name(adapter):
    assert adapter.name == "mtgjson"


async def test_missing_file():
    adapter = MtgjsonAdapter(local_path="/nonexistent/path.json")
    sets = await adapter.list_sets()
    assert sets == []


def test_parse_mtgjson_card_basic():
    raw = {
        "uuid": "test-uuid",
        "name": "Test Card",
        "manaCost": "{2}{W}",
        "manaValue": 3.0,
        "types": ["Creature"],
        "subtypes": ["Human", "Soldier"],
        "supertypes": ["Legendary"],
        "power": "2",
        "toughness": "3",
        "text": "First strike",
        "colors": ["W"],
        "colorIdentity": ["W"],
        "keywords": ["First strike"],
        "number": "42",
        "rarity": "uncommon",
        "layout": "normal",
        "identifiers": {},
    }
    card = _parse_mtgjson_card(raw, "TST")
    assert card.name == "Test Card"
    assert card.types == ["Creature"]
    assert card.subtypes == ["Human", "Soldier"]
    assert card.supertypes == ["Legendary"]
    assert card.power == "2"
    assert card.toughness == "3"
