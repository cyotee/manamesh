"""Tests for base and game-specific data models."""

from card_scraper.models import CardDataBase, SetInfo, ScrapeState
from card_scraper.games.onepiece.models import OnePieceCardData
from card_scraper.games.mtg.models import MTGCardData


def test_set_info_creation():
    s = SetInfo(id="OP-01", name="Romance Dawn", category="booster")
    assert s.id == "OP-01"
    assert s.name == "Romance Dawn"
    assert s.category == "booster"


def test_base_card_data():
    card = CardDataBase(
        id="test-001",
        name="Test Card",
        image_url="http://example.com/img.jpg",
        set_id="TEST",
        source="test",
        rarity="common",
    )
    assert card.id == "test-001"
    assert card.name == "Test Card"


def test_onepiece_card_data():
    card = OnePieceCardData(
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
    )
    assert card.card_type == "character"
    assert card.power == 5000
    assert card.counter == 1000
    assert isinstance(card, CardDataBase)


def test_mtg_card_data():
    card = MTGCardData(
        id="abc-123",
        name="Lightning Bolt",
        image_url="http://example.com/bolt.jpg",
        set_id="LEA",
        source="scryfall-bulk",
        rarity="common",
        mana_cost="{R}",
        cmc=1.0,
        types=["Instant"],
        colors=["R"],
        color_identity=["R"],
        oracle_text="Lightning Bolt deals 3 damage to any target.",
        collector_number="161",
    )
    assert card.mana_cost == "{R}"
    assert card.cmc == 1.0
    assert card.types == ["Instant"]
    assert isinstance(card, CardDataBase)


def test_mtg_card_string_power():
    """Power/toughness must be strings for *, X, 1+*, etc."""
    card = MTGCardData(
        id="tar-001",
        name="Tarmogoyf",
        image_url="",
        set_id="FUT",
        source="scryfall-bulk",
        power="*",
        toughness="1+*",
    )
    assert card.power == "*"
    assert card.toughness == "1+*"


def test_mtg_card_string_loyalty():
    card = MTGCardData(
        id="jace-001",
        name="Jace, the Mind Sculptor",
        image_url="",
        set_id="WWK",
        source="scryfall-bulk",
        loyalty="3",
    )
    assert card.loyalty == "3"


def test_scrape_state_mark_card():
    state = ScrapeState()
    state.mark_card_scraped("OP-01", "OP01-001")
    assert state.is_card_scraped("OP-01", "OP01-001")
    assert not state.is_card_scraped("OP-01", "OP01-999")


def test_scrape_state_mark_image():
    state = ScrapeState()
    state.mark_image("OP-01", "OP01-001", "success", path="/img/OP01-001.jpg")
    assert state.is_image_downloaded("OP-01", "OP01-001")
    assert not state.is_image_downloaded("OP-01", "OP01-999")


def test_scrape_state_empty():
    state = ScrapeState()
    assert not state.is_card_scraped("X", "Y")
    assert not state.is_image_downloaded("X", "Y")
