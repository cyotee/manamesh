"""Tests for the state tracker."""

import json

from card_scraper.state import StateTracker


def test_state_tracker_fresh(tmp_path):
    tracker = StateTracker(str(tmp_path / "state.json"))
    assert tracker.state.sets == {}


def test_state_tracker_save_and_load(tmp_path):
    state_file = str(tmp_path / "state.json")
    tracker1 = StateTracker(state_file)
    tracker1.state.mark_card_scraped("OP-01", "OP01-001")
    tracker1.state.mark_image("OP-01", "OP01-001", "success", path="/img/OP01-001.jpg")
    tracker1.save()

    tracker2 = StateTracker(state_file)
    assert tracker2.state.is_card_scraped("OP-01", "OP01-001")
    assert tracker2.state.is_image_downloaded("OP-01", "OP01-001")


def test_state_tracker_reset(tmp_path):
    tracker = StateTracker(str(tmp_path / "state.json"))
    tracker.state.mark_card_scraped("OP-01", "OP01-001")
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
    tracker.state.mark_image("OP-01", "OP01-002", "failed", error="404")

    summary = tracker.summary()
    assert summary["sets_scraped"] == 1
    assert summary["total_cards"] == 2
    assert summary["images_downloaded"] == 1
    assert summary["images_failed"] == 1


def test_state_tracker_corrupt_file(tmp_path):
    state_file = tmp_path / "state.json"
    state_file.write_text("not valid json!!!")
    tracker = StateTracker(str(state_file))
    assert tracker.state.sets == {}


def test_state_file_is_human_readable(tmp_path):
    state_file = tmp_path / "state.json"
    tracker = StateTracker(str(state_file))
    tracker.state.mark_card_scraped("OP-01", "OP01-001")
    tracker.save()
    data = json.loads(state_file.read_text())
    assert "sets" in data
    assert "OP-01" in data["sets"]
