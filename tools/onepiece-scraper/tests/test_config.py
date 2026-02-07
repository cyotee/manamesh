"""Tests for configuration loading and validation."""

import pytest
import yaml
from pathlib import Path

from onepiece_scraper.config import AppConfig, OutputConfig, ScrapeConfig, SourceConfig, load_config, _parse_config


def test_default_config():
    config = AppConfig()
    assert len(config.sources) == 3
    assert config.sources[0].name == "optcg-api"
    assert config.output.base_dir == "./output/onepiece/"
    assert config.scrape.sets == "all"


def test_enabled_sources_sorted_by_priority():
    config = AppConfig(
        sources=[
            SourceConfig(name="ryan-api", priority=2),
            SourceConfig(name="optcg-api", priority=1),
            SourceConfig(name="vegapull-records", priority=3, enabled=False),
        ]
    )
    enabled = config.enabled_sources
    assert len(enabled) == 2
    assert enabled[0].name == "optcg-api"
    assert enabled[1].name == "ryan-api"


def test_set_filter_all():
    config = AppConfig()
    assert config.set_filter is None


def test_set_filter_specific():
    config = AppConfig(scrape=ScrapeConfig(sets="OP-01,OP-02"))
    assert config.set_filter == ["OP-01", "OP-02"]


def test_parse_config_from_dict():
    raw = {
        "sources": [
            {"name": "optcg-api", "enabled": True, "priority": 1, "rate_limit_ms": 100},
            {"name": "ryan-api", "enabled": False, "priority": 2},
        ],
        "output": {"base_dir": "/tmp/output/"},
        "scrape": {"sets": "OP-01", "include_starters": False},
        "state": {"state_file": "/tmp/state.json"},
    }
    config = _parse_config(raw)
    assert len(config.sources) == 2
    assert config.sources[0].rate_limit_ms == 100
    assert not config.sources[1].enabled
    assert config.output.base_dir == "/tmp/output/"
    assert config.scrape.sets == "OP-01"
    assert not config.scrape.include_starters
    assert config.state.state_file == "/tmp/state.json"


def test_validate_config_no_sources():
    with pytest.raises(ValueError, match="at least one source"):
        _parse_config({"sources": []})


def test_validate_config_duplicate_names():
    with pytest.raises(ValueError, match="duplicate source names"):
        _parse_config({
            "sources": [
                {"name": "optcg-api", "priority": 1},
                {"name": "optcg-api", "priority": 2},
            ]
        })


def test_validate_config_unknown_source():
    with pytest.raises(ValueError, match="unknown source"):
        _parse_config({
            "sources": [{"name": "made-up-source", "priority": 1}]
        })


def test_validate_config_no_enabled():
    with pytest.raises(ValueError, match="no enabled sources"):
        _parse_config({
            "sources": [
                {"name": "optcg-api", "enabled": False},
            ]
        })


def test_load_config_missing_file(tmp_path):
    config = load_config(tmp_path / "nonexistent.yaml")
    assert isinstance(config, AppConfig)
    assert len(config.sources) == 3  # defaults


def test_load_config_from_file(tmp_path):
    cfg_path = tmp_path / "config.yaml"
    cfg_path.write_text(yaml.dump({
        "sources": [
            {"name": "optcg-api", "priority": 1, "rate_limit_ms": 300},
        ],
        "output": {"base_dir": str(tmp_path / "out")},
    }))
    config = load_config(cfg_path)
    assert len(config.sources) == 1
    assert config.sources[0].rate_limit_ms == 300
