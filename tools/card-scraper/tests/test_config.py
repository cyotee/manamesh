"""Tests for multi-game configuration."""

import pytest
import yaml
from pathlib import Path

from card_scraper.config import AppConfig, GameConfig, SourceConfig, load_config, _parse_config, _validate_config


def test_default_config():
    """Default config should have onepiece game with 3 sources."""
    config = AppConfig()
    assert config.game == "onepiece"
    assert "onepiece" in config.games
    assert len(config.games["onepiece"].sources) == 3


def test_active_game_property():
    config = AppConfig()
    assert config.active_game is config.games["onepiece"]


def test_enabled_sources_sorted_by_priority():
    config = AppConfig()
    sources = config.enabled_sources
    assert sources[0].name == "optcg-api"
    assert sources[0].priority < sources[1].priority


def test_set_filter_all():
    config = AppConfig()
    assert config.set_filter is None


def test_set_filter_specific():
    config = AppConfig()
    config.games["onepiece"].scrape.sets = "OP-01,OP-02"
    assert config.set_filter == ["OP-01", "OP-02"]


def test_parse_multi_game_config():
    raw = {
        "game": "mtg",
        "games": {
            "onepiece": {
                "sources": [
                    {"name": "optcg-api", "priority": 1},
                ],
                "scrape": {"sets": "all"},
            },
            "mtg": {
                "sources": [
                    {"name": "scryfall-bulk", "priority": 1, "image_size": "large"},
                    {"name": "scryfall-api", "priority": 2, "rate_limit_ms": 150},
                ],
                "scrape": {"sets": "MKM,LCI", "categories": ["core", "expansion"]},
            },
        },
        "output": {"base_dir": "./out/"},
    }
    config = _parse_config(raw)
    assert config.game == "mtg"
    assert len(config.games) == 2
    assert len(config.games["mtg"].sources) == 2
    assert config.games["mtg"].sources[0].image_size == "large"
    assert config.games["mtg"].scrape.categories == ["core", "expansion"]
    assert config.output.base_dir == "./out/"


def test_parse_legacy_single_game_config():
    """Legacy config without 'games' key should parse as onepiece."""
    raw = {
        "sources": [
            {"name": "optcg-api", "priority": 1},
        ],
        "scrape": {"sets": "all"},
    }
    config = _parse_config(raw)
    assert "onepiece" in config.games
    assert len(config.games["onepiece"].sources) == 1


def test_validate_config_unknown_game():
    config = AppConfig(game="pokemon")
    with pytest.raises(ValueError, match="active game 'pokemon'"):
        _validate_config(config)


def test_validate_config_no_sources():
    config = AppConfig(
        game="onepiece",
        games={"onepiece": GameConfig(sources=[])},
    )
    with pytest.raises(ValueError, match="no sources defined"):
        _validate_config(config)


def test_validate_config_duplicate_names():
    config = AppConfig(
        game="onepiece",
        games={"onepiece": GameConfig(sources=[
            SourceConfig(name="optcg-api"),
            SourceConfig(name="optcg-api"),
        ])},
    )
    with pytest.raises(ValueError, match="duplicate source names"):
        _validate_config(config)


def test_validate_config_unknown_source():
    config = AppConfig(
        game="onepiece",
        games={"onepiece": GameConfig(sources=[
            SourceConfig(name="fake-source"),
        ])},
    )
    with pytest.raises(ValueError, match="unknown source"):
        _validate_config(config)


def test_validate_config_no_enabled():
    config = AppConfig(
        game="onepiece",
        games={"onepiece": GameConfig(sources=[
            SourceConfig(name="optcg-api", enabled=False),
        ])},
    )
    with pytest.raises(ValueError, match="no enabled sources"):
        _validate_config(config)


def test_load_config_missing_file(tmp_path):
    """Loading from a missing file should return defaults."""
    config = load_config(tmp_path / "nonexistent.yaml")
    assert config.game == "onepiece"


def test_load_config_from_file(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(yaml.dump({
        "game": "onepiece",
        "games": {
            "onepiece": {
                "sources": [{"name": "optcg-api", "priority": 1}],
            },
        },
    }))
    config = load_config(config_path)
    assert config.game == "onepiece"
    assert len(config.enabled_sources) == 1


def test_load_config_game_override(tmp_path):
    """CLI --game flag should override config default."""
    config_path = tmp_path / "config.yaml"
    config_path.write_text(yaml.dump({
        "game": "onepiece",
        "games": {
            "onepiece": {
                "sources": [{"name": "optcg-api", "priority": 1}],
            },
            "mtg": {
                "sources": [{"name": "scryfall-bulk", "priority": 1}],
            },
        },
    }))
    config = load_config(config_path, game="mtg")
    assert config.game == "mtg"
    assert config.enabled_sources[0].name == "scryfall-bulk"
