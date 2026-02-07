"""Tests for the OPTCG API adapter with mocked HTTP responses."""

import pytest
import httpx
import respx

from onepiece_scraper.adapters.optcg_api import OptcgApiAdapter, BASE_URL


@pytest.fixture
def adapter():
    return OptcgApiAdapter(rate_limit_ms=0)


@pytest.fixture
def mock_api():
    with respx.mock(base_url=BASE_URL) as rsps:
        yield rsps


@pytest.mark.asyncio
async def test_list_sets(adapter, mock_api):
    mock_api.get("/api/allSets/").mock(return_value=httpx.Response(
        200,
        json=[
            {"id": "OP-01", "name": "Romance Dawn"},
            {"id": "OP-02", "name": "Paramount War"},
        ],
    ))

    sets = await adapter.list_sets()
    assert len(sets) == 2
    assert sets[0].id == "OP-01"
    assert sets[0].name == "Romance Dawn"
    assert sets[0].category == "booster"
    await adapter.close()


@pytest.mark.asyncio
async def test_get_cards(adapter, mock_api):
    mock_api.get("/api/sets/OP-01/").mock(return_value=httpx.Response(
        200,
        json=[
            {
                "card_set_id": "OP01-001",
                "card_name": "Roronoa Zoro",
                "card_type": "Character",
                "card_cost": 3,
                "card_power": 5000,
                "counter_amount": 1000,
                "card_color": "Red",
                "rarity": "SR",
                "sub_types": "Supernovas/Straw Hat Crew",
                "card_text": "Rush",
                "life": None,
                "card_image": "/media/static/Card_Images/OP01-001.jpg",
            },
        ],
    ))

    cards = await adapter.get_cards("OP-01")
    assert len(cards) == 1
    c = cards[0]
    assert c.id == "OP01-001"
    assert c.name == "Roronoa Zoro"
    assert c.card_type == "character"
    assert c.cost == 3
    assert c.power == 5000
    assert c.counter == 1000
    assert c.colors == ["Red"]
    assert c.rarity == "SR"
    assert c.traits == ["Supernovas", "Straw Hat Crew"]
    assert c.text == "Rush"
    assert c.life is None
    assert "OP01-001" in c.image_url
    assert c.source == "optcg-api"
    await adapter.close()


@pytest.mark.asyncio
async def test_get_cards_multicolor(adapter, mock_api):
    mock_api.get("/api/sets/OP-01/").mock(return_value=httpx.Response(
        200,
        json=[
            {
                "card_set_id": "OP01-050",
                "card_name": "Dual Color Card",
                "card_type": "Character",
                "card_cost": 5,
                "card_power": 6000,
                "counter_amount": None,
                "card_color": "Red/Green",
                "rarity": "R",
                "sub_types": "",
                "card_text": "",
                "life": None,
                "card_image": "",
            },
        ],
    ))

    cards = await adapter.get_cards("OP-01")
    assert cards[0].colors == ["Red", "Green"]
    await adapter.close()


@pytest.mark.asyncio
async def test_get_promo_cards(adapter, mock_api):
    mock_api.get("/api/allPromoCards/").mock(return_value=httpx.Response(
        200,
        json=[
            {
                "card_set_id": "P-001",
                "card_name": "Promo Luffy",
                "card_type": "Leader",
                "card_cost": None,
                "card_power": 5000,
                "counter_amount": None,
                "card_color": "Red",
                "rarity": "P",
                "sub_types": "Straw Hat Crew",
                "card_text": "",
                "life": 5,
                "card_image": "",
            },
        ],
    ))

    cards = await adapter.get_cards("PROMO")
    assert len(cards) == 1
    assert cards[0].life == 5
    assert cards[0].card_type == "leader"
    await adapter.close()


@pytest.mark.asyncio
async def test_get_starter_cards(adapter, mock_api):
    mock_api.get("/api/allSTCards/").mock(return_value=httpx.Response(
        200,
        json=[
            {
                "card_set_id": "ST01-001",
                "card_name": "Starter Card",
                "card_type": "Character",
                "card_cost": 1,
                "card_power": 3000,
                "counter_amount": 1000,
                "card_color": "Red",
                "rarity": "C",
                "sub_types": "",
                "card_text": "",
                "life": None,
                "card_image": "",
            },
            {
                "card_set_id": "ST02-001",
                "card_name": "Other Starter",
                "card_type": "Character",
                "card_cost": 2,
                "card_power": 4000,
                "counter_amount": None,
                "card_color": "Blue",
                "rarity": "C",
                "sub_types": "",
                "card_text": "",
                "life": None,
                "card_image": "",
            },
        ],
    ))

    cards = await adapter.get_cards("ST01")
    # Should only return cards from ST01, not ST02
    assert len(cards) == 1
    assert cards[0].id == "ST01-001"
    await adapter.close()


@pytest.mark.asyncio
async def test_get_image_url(adapter):
    from onepiece_scraper.models import CardData

    card = CardData(
        id="OP01-001",
        name="Test",
        card_type="character",
        cost=1,
        power=1000,
        counter=None,
        colors=["Red"],
        rarity="C",
        traits=[],
        text="",
        life=None,
        image_url="",
        set_id="OP-01",
        source="optcg-api",
    )
    url = adapter.get_image_url(card)
    assert url == "https://optcgapi.com/media/static/Card_Images/OP01-001.jpg"
    await adapter.close()


@pytest.mark.asyncio
async def test_adapter_name(adapter):
    assert adapter.name == "optcg-api"
    await adapter.close()
