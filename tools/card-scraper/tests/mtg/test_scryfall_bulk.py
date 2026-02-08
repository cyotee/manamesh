"""Tests for the Scryfall Bulk Data adapter."""

import pytest

from card_scraper.games.mtg.adapters.scryfall_bulk import _parse_scryfall_card


# Sample Scryfall card fixtures
LIGHTNING_BOLT = {
    "id": "f29ba16f-c8fb-42fe-aabf-87089cb214a7",
    "name": "Lightning Bolt",
    "mana_cost": "{R}",
    "cmc": 1.0,
    "type_line": "Instant",
    "oracle_text": "Lightning Bolt deals 3 damage to any target.",
    "colors": ["R"],
    "color_identity": ["R"],
    "keywords": [],
    "set": "lea",
    "set_name": "Limited Edition Alpha",
    "set_type": "core",
    "collector_number": "161",
    "rarity": "common",
    "layout": "normal",
    "image_uris": {
        "small": "https://cards.scryfall.io/small/front/f/2/f29ba16f.jpg",
        "normal": "https://cards.scryfall.io/normal/front/f/2/f29ba16f.jpg",
        "large": "https://cards.scryfall.io/large/front/f/2/f29ba16f.jpg",
    },
}

TARMOGOYF = {
    "id": "tarm-001",
    "name": "Tarmogoyf",
    "mana_cost": "{1}{G}",
    "cmc": 2.0,
    "type_line": "Creature \u2014 Lhurgoyf",
    "oracle_text": "Tarmogoyf's power is equal to...",
    "power": "*",
    "toughness": "1+*",
    "colors": ["G"],
    "color_identity": ["G"],
    "keywords": [],
    "set": "fut",
    "set_name": "Future Sight",
    "set_type": "expansion",
    "collector_number": "153",
    "rarity": "rare",
    "layout": "normal",
    "image_uris": {"normal": "https://cards.scryfall.io/normal/tarm.jpg"},
}

LEGENDARY_CREATURE = {
    "id": "leg-001",
    "name": "Atraxa, Praetors' Voice",
    "mana_cost": "{G}{W}{U}{B}",
    "cmc": 4.0,
    "type_line": "Legendary Creature \u2014 Phyrexian Angel Horror",
    "oracle_text": "Flying, vigilance, deathtouch, lifelink\nProliferate.",
    "power": "4",
    "toughness": "4",
    "colors": ["W", "U", "B", "G"],
    "color_identity": ["W", "U", "B", "G"],
    "keywords": ["Flying", "Vigilance", "Deathtouch", "Lifelink", "Proliferate"],
    "set": "c16",
    "set_name": "Commander 2016",
    "set_type": "commander",
    "collector_number": "28",
    "rarity": "mythic",
    "layout": "normal",
    "image_uris": {"normal": "https://cards.scryfall.io/normal/atraxa.jpg"},
}

DOUBLE_FACED = {
    "id": "dfc-001",
    "name": "Delver of Secrets // Insectile Aberration",
    "mana_cost": "{U}",
    "cmc": 1.0,
    "type_line": "Creature \u2014 Human Wizard // Creature \u2014 Human Insect",
    "colors": ["U"],
    "color_identity": ["U"],
    "keywords": ["Transform"],
    "set": "isd",
    "set_name": "Innistrad",
    "set_type": "expansion",
    "collector_number": "51",
    "rarity": "common",
    "layout": "transform",
    "card_faces": [
        {
            "name": "Delver of Secrets",
            "mana_cost": "{U}",
            "type_line": "Creature \u2014 Human Wizard",
            "oracle_text": "At the beginning of your upkeep...",
            "power": "1",
            "toughness": "1",
            "image_uris": {"normal": "https://cards.scryfall.io/normal/delver-front.jpg"},
        },
        {
            "name": "Insectile Aberration",
            "mana_cost": "",
            "type_line": "Creature \u2014 Human Insect",
            "oracle_text": "Flying",
            "power": "3",
            "toughness": "2",
            "image_uris": {"normal": "https://cards.scryfall.io/normal/delver-back.jpg"},
        },
    ],
}

PLANESWALKER = {
    "id": "pw-001",
    "name": "Jace, the Mind Sculptor",
    "mana_cost": "{2}{U}{U}",
    "cmc": 4.0,
    "type_line": "Legendary Planeswalker \u2014 Jace",
    "oracle_text": "+2: Look at the top card...",
    "loyalty": "3",
    "colors": ["U"],
    "color_identity": ["U"],
    "keywords": [],
    "set": "wwk",
    "set_name": "Worldwake",
    "set_type": "expansion",
    "collector_number": "31",
    "rarity": "mythic",
    "layout": "normal",
    "image_uris": {"normal": "https://cards.scryfall.io/normal/jace.jpg"},
}

BASIC_LAND = {
    "id": "land-001",
    "name": "Island",
    "cmc": 0.0,
    "type_line": "Basic Land \u2014 Island",
    "colors": [],
    "color_identity": ["U"],
    "keywords": [],
    "set": "lea",
    "set_name": "Limited Edition Alpha",
    "set_type": "core",
    "collector_number": "289",
    "rarity": "common",
    "layout": "normal",
    "image_uris": {"normal": "https://cards.scryfall.io/normal/island.jpg"},
}


class TestParseScryfallCard:
    def test_instant(self):
        card = _parse_scryfall_card(LIGHTNING_BOLT, "LEA")
        assert card.name == "Lightning Bolt"
        assert card.mana_cost == "{R}"
        assert card.cmc == 1.0
        assert card.types == ["Instant"]
        assert card.subtypes == []
        assert card.colors == ["R"]
        assert card.rarity == "common"
        assert card.collector_number == "161"
        assert "normal" in card.image_url

    def test_star_power_toughness(self):
        card = _parse_scryfall_card(TARMOGOYF, "FUT")
        assert card.power == "*"
        assert card.toughness == "1+*"
        assert card.types == ["Creature"]
        assert card.subtypes == ["Lhurgoyf"]

    def test_legendary_creature(self):
        card = _parse_scryfall_card(LEGENDARY_CREATURE, "C16")
        assert card.supertypes == ["Legendary"]
        assert card.types == ["Creature"]
        assert card.subtypes == ["Phyrexian", "Angel", "Horror"]
        assert "Proliferate" in card.keywords

    def test_double_faced_card(self):
        card = _parse_scryfall_card(DOUBLE_FACED, "ISD")
        assert card.layout == "transform"
        assert card.card_faces is not None
        assert len(card.card_faces) == 2
        assert card.card_faces[0]["name"] == "Delver of Secrets"
        assert card.card_faces[0]["power"] == "1"
        assert card.card_faces[1]["name"] == "Insectile Aberration"
        # Image should come from first face when top-level image_uris absent
        assert "delver-front" in card.image_url

    def test_planeswalker(self):
        card = _parse_scryfall_card(PLANESWALKER, "WWK")
        assert card.loyalty == "3"
        assert card.supertypes == ["Legendary"]
        assert card.types == ["Planeswalker"]
        assert card.subtypes == ["Jace"]

    def test_basic_land(self):
        card = _parse_scryfall_card(BASIC_LAND, "LEA")
        assert card.supertypes == ["Basic"]
        assert card.types == ["Land"]
        assert card.subtypes == ["Island"]
        assert card.mana_cost is None

    def test_image_size_selection(self):
        card = _parse_scryfall_card(LIGHTNING_BOLT, "LEA", image_size="large")
        assert "large" in card.image_url

    def test_source_is_scryfall_bulk(self):
        card = _parse_scryfall_card(LIGHTNING_BOLT, "LEA")
        assert card.source == "scryfall-bulk"
