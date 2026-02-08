"""Tests for the Ryan API adapter."""

import pytest
import respx
import httpx

from card_scraper.games.onepiece.adapters.ryan_api import RyanApiAdapter


@pytest.fixture
def adapter():
    return RyanApiAdapter(rate_limit_ms=0)


@respx.mock(base_url="https://optcg-api.com")
async def test_list_sets(respx_mock, adapter):
    respx_mock.get("/api/v1/cards").mock(return_value=httpx.Response(200, json={
        "data": [
            {"code": "OP01-001", "set": "OP01", "name": "Card 1"},
            {"code": "OP02-001", "set": "OP02", "name": "Card 2"},
        ]
    }))
    sets = await adapter.list_sets()
    assert len(sets) == 2
    await adapter.close()


@respx.mock(base_url="https://optcg-api.com")
async def test_get_cards(respx_mock, adapter):
    respx_mock.get("/api/v1/cards").mock(return_value=httpx.Response(200, json={
        "data": [
            {"code": "OP01-001", "name": "Zoro", "type": "Character", "rarity": "SR"},
        ]
    }))
    cards = await adapter.get_cards("OP01")
    assert len(cards) == 1
    assert cards[0].name == "Zoro"
    await adapter.close()


@respx.mock(base_url="https://optcg-api.com")
async def test_get_cards_pagination(respx_mock, adapter):
    # Page 1: full page (100 items)
    page1 = [{"code": f"OP01-{i:03d}", "name": f"Card {i}", "type": "Character", "rarity": "C"}
             for i in range(100)]
    # Page 2: partial page (2 items)
    page2 = [{"code": f"OP01-{i:03d}", "name": f"Card {i}", "type": "Character", "rarity": "C"}
             for i in range(100, 102)]

    call_count = 0

    def side_effect(request):
        nonlocal call_count
        call_count += 1
        page = int(request.url.params.get("page", "1"))
        if page == 1:
            return httpx.Response(200, json={"data": page1})
        return httpx.Response(200, json={"data": page2})

    respx_mock.get("/api/v1/cards").mock(side_effect=side_effect)
    cards = await adapter.get_cards("OP01")
    assert len(cards) == 102
    await adapter.close()


@respx.mock(base_url="https://optcg-api.com")
async def test_get_cards_empty(respx_mock, adapter):
    respx_mock.get("/api/v1/cards").mock(return_value=httpx.Response(200, json={"data": []}))
    cards = await adapter.get_cards("EMPTY")
    assert len(cards) == 0
    await adapter.close()


def test_adapter_name(adapter):
    assert adapter.name == "ryan-api"
