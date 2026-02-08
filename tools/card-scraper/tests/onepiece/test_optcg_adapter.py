"""Tests for the OPTCG API adapter."""

import pytest
import respx
import httpx

from card_scraper.games.onepiece.adapters.optcg_api import OptcgApiAdapter


@pytest.fixture
def adapter():
    return OptcgApiAdapter(rate_limit_ms=0)


@respx.mock(base_url="https://optcgapi.com")
async def test_list_sets(respx_mock, adapter):
    respx_mock.get("/api/allSets/").mock(return_value=httpx.Response(200, json=[
        {"id": "OP-01", "name": "Romance Dawn"},
        {"id": "OP-02", "name": "Paramount War"},
    ]))
    sets = await adapter.list_sets()
    assert len(sets) == 2
    assert sets[0].id == "OP-01"
    assert sets[0].category == "booster"
    await adapter.close()


@respx.mock(base_url="https://optcgapi.com")
async def test_get_cards(respx_mock, adapter):
    respx_mock.get("/api/sets/OP-01/").mock(return_value=httpx.Response(200, json=[
        {
            "card_set_id": "OP01-001",
            "card_name": "Roronoa Zoro",
            "card_type": "Character",
            "card_cost": "3",
            "card_power": "5000",
            "counter_amount": "1000",
            "card_color": "Red",
            "rarity": "SR",
            "sub_types": "Supernovas/Straw Hat Crew",
            "card_text": "Rush",
            "card_image": "/media/static/Card_Images/OP01-001.jpg",
        },
    ]))
    cards = await adapter.get_cards("OP-01")
    assert len(cards) == 1
    assert cards[0].id == "OP01-001"
    assert cards[0].name == "Roronoa Zoro"
    assert cards[0].power == 5000
    assert cards[0].traits == ["Supernovas", "Straw Hat Crew"]
    await adapter.close()


@respx.mock(base_url="https://optcgapi.com")
async def test_get_cards_multicolor(respx_mock, adapter):
    respx_mock.get("/api/sets/OP-01/").mock(return_value=httpx.Response(200, json=[
        {
            "card_set_id": "OP01-100",
            "card_name": "Multi Card",
            "card_type": "Character",
            "card_color": "Red/Green",
            "rarity": "C",
        },
    ]))
    cards = await adapter.get_cards("OP-01")
    assert cards[0].colors == ["Red", "Green"]
    await adapter.close()


@respx.mock(base_url="https://optcgapi.com")
async def test_get_promo_cards(respx_mock, adapter):
    respx_mock.get("/api/allPromoCards/").mock(return_value=httpx.Response(200, json=[
        {"card_set_id": "P-001", "card_name": "Promo Card", "card_type": "Character", "rarity": "P"},
    ]))
    cards = await adapter.get_cards("PROMO")
    assert len(cards) == 1
    assert cards[0].id == "P-001"
    await adapter.close()


@respx.mock(base_url="https://optcgapi.com")
async def test_get_starter_cards(respx_mock, adapter):
    respx_mock.get("/api/allSTCards/").mock(return_value=httpx.Response(200, json=[
        {"card_set_id": "ST01-001", "card_name": "Starter 1", "card_type": "Character", "rarity": "C"},
        {"card_set_id": "ST02-001", "card_name": "Other Set", "card_type": "Character", "rarity": "C"},
    ]))
    cards = await adapter.get_cards("ST-01")
    assert len(cards) == 1
    assert cards[0].id == "ST01-001"
    await adapter.close()


def test_get_image_url(adapter):
    from card_scraper.games.onepiece.models import OnePieceCardData
    card = OnePieceCardData(
        id="OP01-001", name="Test", image_url="", set_id="OP-01", source="optcg-api",
    )
    url = adapter.get_image_url(card)
    assert "OP01-001" in url


def test_adapter_name(adapter):
    assert adapter.name == "optcg-api"
