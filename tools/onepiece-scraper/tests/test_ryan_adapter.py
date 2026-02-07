"""Tests for the Ryan API adapter with mocked HTTP responses."""

import pytest
import httpx
import respx

from onepiece_scraper.adapters.ryan_api import RyanApiAdapter, BASE_URL


@pytest.fixture
def adapter():
    return RyanApiAdapter(rate_limit_ms=0)


@pytest.fixture
def mock_api():
    with respx.mock(base_url=BASE_URL) as rsps:
        yield rsps


@pytest.mark.asyncio
async def test_list_sets(adapter, mock_api):
    mock_api.get("/api/v1/cards").mock(return_value=httpx.Response(
        200,
        json={
            "data": [
                {"code": "OP01-001", "name": "Zoro", "set": "OP01"},
                {"code": "OP02-001", "name": "Luffy", "set": "OP02"},
            ]
        },
    ))

    sets = await adapter.list_sets()
    assert len(sets) >= 2
    ids = {s.id for s in sets}
    assert "OP01" in ids
    assert "OP02" in ids
    await adapter.close()


@pytest.mark.asyncio
async def test_get_cards(adapter, mock_api):
    mock_api.get("/api/v1/cards").mock(return_value=httpx.Response(
        200,
        json={
            "data": [
                {
                    "code": "OP01-001",
                    "name": "Roronoa Zoro",
                    "type": "Character",
                    "cost": 3,
                    "power": 5000,
                    "counter": 1000,
                    "color": "Red",
                    "rarity": "SR",
                    "class": "Supernovas/Straw Hat Crew",
                    "effect": "Rush",
                    "life": None,
                    "image": "https://example.com/OP01-001.jpg",
                },
            ]
        },
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
    assert c.traits == ["Supernovas", "Straw Hat Crew"]
    assert c.text == "Rush"
    assert c.source == "ryan-api"
    await adapter.close()


@pytest.mark.asyncio
async def test_get_cards_pagination(adapter, mock_api):
    """Test that pagination stops when fewer than per_page results returned."""
    mock_api.get("/api/v1/cards").mock(return_value=httpx.Response(
        200,
        json={
            "data": [
                {"code": f"OP01-{i:03d}", "name": f"Card {i}", "type": "Character"}
                for i in range(1, 11)
            ]
        },
    ))

    cards = await adapter.get_cards("OP-01")
    assert len(cards) == 10  # single page, less than per_page=100
    await adapter.close()


@pytest.mark.asyncio
async def test_get_cards_empty(adapter, mock_api):
    mock_api.get("/api/v1/cards").mock(return_value=httpx.Response(
        200,
        json={"data": []},
    ))

    cards = await adapter.get_cards("OP-99")
    assert cards == []
    await adapter.close()


@pytest.mark.asyncio
async def test_adapter_name(adapter):
    assert adapter.name == "ryan-api"
    await adapter.close()
