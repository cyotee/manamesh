"""Tests for data models."""

from onepiece_scraper.models import CardData, CardImageStatus, ScrapeState, SetInfo, SetScrapeState


def test_set_info_creation():
    s = SetInfo(id="OP-01", name="Romance Dawn", category="booster")
    assert s.id == "OP-01"
    assert s.name == "Romance Dawn"
    assert s.category == "booster"


def test_card_data_creation():
    card = CardData(
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
        image_url="https://example.com/OP01-001.jpg",
        set_id="OP-01",
        source="optcg-api",
    )
    assert card.id == "OP01-001"
    assert card.colors == ["Red"]
    assert card.life is None


def test_scrape_state_mark_card():
    state = ScrapeState()
    assert not state.is_card_scraped("OP-01", "OP01-001")

    state.mark_card_scraped("OP-01", "OP01-001")
    assert state.is_card_scraped("OP-01", "OP01-001")
    assert not state.is_card_scraped("OP-01", "OP01-002")

    # Marking same card twice doesn't duplicate
    state.mark_card_scraped("OP-01", "OP01-001")
    assert len(state.sets["OP-01"].card_ids) == 1


def test_scrape_state_mark_image():
    state = ScrapeState()
    assert not state.is_image_downloaded("OP-01", "OP01-001")

    state.mark_image("OP-01", "OP01-001", "success", path="/output/OP-01/cards/OP01-001.jpg")
    assert state.is_image_downloaded("OP-01", "OP01-001")

    state.mark_image("OP-01", "OP01-002", "failed", error="404 Not Found")
    assert not state.is_image_downloaded("OP-01", "OP01-002")


def test_scrape_state_empty():
    state = ScrapeState()
    assert not state.is_card_scraped("OP-01", "OP01-001")
    assert not state.is_image_downloaded("OP-01", "OP01-001")
