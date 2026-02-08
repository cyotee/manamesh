"""Tests for the Scryfall REST API adapter."""

import pytest
import respx
import httpx

from card_scraper.games.mtg.adapters.scryfall_api import ScryfallApiAdapter


@pytest.fixture
def adapter():
    return ScryfallApiAdapter(rate_limit_ms=0, image_size="normal")


@respx.mock(base_url="https://api.scryfall.com")
async def test_list_sets(respx_mock, adapter):
    respx_mock.get("/sets").mock(return_value=httpx.Response(200, json={
        "data": [
            {"code": "mkm", "name": "Murders at Karlov Manor", "set_type": "expansion"},
            {"code": "lci", "name": "The Lost Caverns of Ixalan", "set_type": "expansion"},
        ]
    }))
    sets = await adapter.list_sets()
    assert len(sets) == 2
    assert sets[0].id == "MKM"
    assert sets[0].category == "expansion"
    await adapter.close()


@respx.mock(base_url="https://api.scryfall.com")
async def test_get_cards_single_page(respx_mock, adapter):
    respx_mock.get("/cards/search").mock(return_value=httpx.Response(200, json={
        "data": [
            {
                "id": "card-001",
                "name": "Test Card",
                "mana_cost": "{1}{W}",
                "cmc": 2.0,
                "type_line": "Creature \u2014 Human",
                "colors": ["W"],
                "color_identity": ["W"],
                "keywords": [],
                "set": "mkm",
                "collector_number": "1",
                "rarity": "common",
                "layout": "normal",
                "image_uris": {"normal": "https://cards.scryfall.io/normal/test.jpg"},
            },
        ],
        "has_more": False,
    }))
    cards = await adapter.get_cards("MKM")
    assert len(cards) == 1
    assert cards[0].name == "Test Card"
    await adapter.close()


@respx.mock(base_url="https://api.scryfall.com")
async def test_get_cards_pagination(respx_mock, adapter):
    # Use side_effect to return different responses on sequential calls.
    # Without this, a parameterless mock matches ALL /cards/search requests
    # (including paginated ones), causing an infinite loop.
    page1 = httpx.Response(200, json={
        "data": [
            {
                "id": "card-001", "name": "Card 1", "cmc": 1.0,
                "type_line": "Instant", "colors": [], "color_identity": [],
                "keywords": [], "set": "mkm", "collector_number": "1",
                "rarity": "common", "layout": "normal",
                "image_uris": {"normal": "https://example.com/1.jpg"},
            },
        ],
        "has_more": True,
        "next_page": "https://api.scryfall.com/cards/search?page=2",
    })
    page2 = httpx.Response(200, json={
        "data": [
            {
                "id": "card-002", "name": "Card 2", "cmc": 2.0,
                "type_line": "Sorcery", "colors": [], "color_identity": [],
                "keywords": [], "set": "mkm", "collector_number": "2",
                "rarity": "common", "layout": "normal",
                "image_uris": {"normal": "https://example.com/2.jpg"},
            },
        ],
        "has_more": False,
    })
    respx_mock.get("/cards/search").mock(side_effect=[page1, page2])
    cards = await adapter.get_cards("MKM")
    assert len(cards) == 2
    await adapter.close()


def test_adapter_name(adapter):
    assert adapter.name == "scryfall-api"
