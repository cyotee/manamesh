"""Tests for incremental state tracking."""

import json
from pathlib import Path

from onepiece_scraper.state import StateTracker


def test_state_tracker_fresh(tmp_path):
    tracker = StateTracker(str(tmp_path / "state.json"))
    state = tracker.state
    assert len(state.sets) == 0


def test_state_tracker_save_and_load(tmp_path):
    state_file = str(tmp_path / "state.json")

    # Save some state
    tracker1 = StateTracker(state_file)
    tracker1.state.mark_card_scraped("OP-01", "OP01-001")
    tracker1.state.mark_card_scraped("OP-01", "OP01-002")
    tracker1.state.mark_image("OP-01", "OP01-001", "success", path="/out/OP-01/cards/OP01-001.jpg")
    tracker1.state.mark_image("OP-01", "OP01-002", "failed", error="404")
    tracker1.save()

    # Load in a new tracker
    tracker2 = StateTracker(state_file)
    state = tracker2.state
    assert state.is_card_scraped("OP-01", "OP01-001")
    assert state.is_card_scraped("OP-01", "OP01-002")
    assert state.is_image_downloaded("OP-01", "OP01-001")
    assert not state.is_image_downloaded("OP-01", "OP01-002")


def test_state_tracker_reset(tmp_path):
    state_file = str(tmp_path / "state.json")
    tracker = StateTracker(state_file)
    tracker.state.mark_card_scraped("OP-01", "OP01-001")
    tracker.save()

    tracker.reset()
    assert not tracker.state.is_card_scraped("OP-01", "OP01-001")


def test_state_tracker_delete(tmp_path):
    state_file = tmp_path / "state.json"
    tracker = StateTracker(str(state_file))
    tracker.state.mark_card_scraped("OP-01", "OP01-001")
    tracker.save()
    assert state_file.exists()

    tracker.delete()
    assert not state_file.exists()


def test_state_tracker_summary(tmp_path):
    tracker = StateTracker(str(tmp_path / "state.json"))
    tracker.state.mark_card_scraped("OP-01", "OP01-001")
    tracker.state.mark_card_scraped("OP-01", "OP01-002")
    tracker.state.mark_image("OP-01", "OP01-001", "success")
    tracker.state.mark_image("OP-01", "OP01-002", "failed")

    summary = tracker.summary()
    assert summary["sets_scraped"] == 1
    assert summary["total_cards"] == 2
    assert summary["images_downloaded"] == 1
    assert summary["images_failed"] == 1
    assert summary["sets"]["OP-01"]["cards"] == 2


def test_state_tracker_corrupt_file(tmp_path):
    state_file = tmp_path / "state.json"
    state_file.write_text("not valid json {{{")

    tracker = StateTracker(str(state_file))
    state = tracker.state
    assert len(state.sets) == 0  # fresh start on corrupt file


def test_state_file_is_human_readable(tmp_path):
    state_file = tmp_path / "state.json"
    tracker = StateTracker(str(state_file))
    tracker.state.mark_card_scraped("OP-01", "OP01-001")
    tracker.state.mark_image("OP-01", "OP01-001", "success", path="/out/OP01-001.jpg")
    tracker.save()

    raw = json.loads(state_file.read_text())
    assert "sets" in raw
    assert "OP-01" in raw["sets"]
    assert "card_ids" in raw["sets"]["OP-01"]
    assert "images" in raw["sets"]["OP-01"]
