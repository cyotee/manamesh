"""YAML configuration loader and validation."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path("config.yaml")


@dataclass
class SourceConfig:
    """Configuration for a single adapter source."""

    name: str
    enabled: bool = True
    priority: int = 1
    rate_limit_ms: int = 200
    local_path: Optional[str] = None


@dataclass
class OutputConfig:
    """Output directory and format settings."""

    base_dir: str = "./output/onepiece/"
    image_format: str = "original"
    manifest_version: str = "1.0"


@dataclass
class ScrapeConfig:
    """What to scrape."""

    sets: str = "all"  # "all" or comma-separated set IDs
    include_starters: bool = True
    include_promos: bool = True


@dataclass
class StateConfig:
    """State persistence settings."""

    state_file: str = "./state/scrape-state.json"


@dataclass
class AppConfig:
    """Top-level application configuration."""

    sources: List[SourceConfig] = field(default_factory=lambda: [
        SourceConfig(name="optcg-api", priority=1, rate_limit_ms=200),
        SourceConfig(name="ryan-api", priority=2, rate_limit_ms=500),
        SourceConfig(name="vegapull-records", priority=3, local_path="./data/vegapull-records/"),
    ])
    output: OutputConfig = field(default_factory=OutputConfig)
    scrape: ScrapeConfig = field(default_factory=ScrapeConfig)
    state: StateConfig = field(default_factory=StateConfig)

    @property
    def enabled_sources(self) -> List[SourceConfig]:
        """Return enabled sources sorted by priority."""
        return sorted(
            [s for s in self.sources if s.enabled],
            key=lambda s: s.priority,
        )

    @property
    def set_filter(self) -> Optional[List[str]]:
        """Return list of set IDs to scrape, or None for all."""
        if self.scrape.sets == "all":
            return None
        return [s.strip() for s in self.scrape.sets.split(",") if s.strip()]


def load_config(path: Optional[Path] = None) -> AppConfig:
    """Load configuration from a YAML file, falling back to defaults."""
    config_path = path or DEFAULT_CONFIG_PATH
    if not config_path.exists():
        logger.info("No config file at %s, using defaults", config_path)
        return AppConfig()

    logger.info("Loading config from %s", config_path)
    with open(config_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    if not raw:
        return AppConfig()

    return _parse_config(raw)


def _parse_config(raw: Dict[str, Any]) -> AppConfig:
    """Parse raw YAML dict into AppConfig."""
    config = AppConfig()

    # Sources
    if "sources" in raw:
        config.sources = []
        for src in raw["sources"]:
            config.sources.append(
                SourceConfig(
                    name=src["name"],
                    enabled=src.get("enabled", True),
                    priority=src.get("priority", 99),
                    rate_limit_ms=src.get("rate_limit_ms", 200),
                    local_path=src.get("local_path"),
                )
            )

    # Output
    if "output" in raw:
        out = raw["output"]
        config.output = OutputConfig(
            base_dir=out.get("base_dir", config.output.base_dir),
            image_format=out.get("image_format", config.output.image_format),
            manifest_version=out.get("manifest_version", config.output.manifest_version),
        )

    # Scrape
    if "scrape" in raw:
        scr = raw["scrape"]
        config.scrape = ScrapeConfig(
            sets=str(scr.get("sets", "all")),
            include_starters=scr.get("include_starters", True),
            include_promos=scr.get("include_promos", True),
        )

    # State
    if "state" in raw:
        st = raw["state"]
        config.state = StateConfig(
            state_file=st.get("state_file", config.state.state_file),
        )

    _validate_config(config)
    return config


def _validate_config(config: AppConfig) -> None:
    """Validate config and raise on errors."""
    if not config.sources:
        raise ValueError("Config error: at least one source must be defined")

    names = [s.name for s in config.sources]
    if len(names) != len(set(names)):
        raise ValueError("Config error: duplicate source names found")

    known = {"optcg-api", "ryan-api", "vegapull-records"}
    for src in config.sources:
        if src.name not in known:
            raise ValueError(f"Config error: unknown source '{src.name}'. Known: {known}")

    enabled = config.enabled_sources
    if not enabled:
        raise ValueError("Config error: no enabled sources")

    logger.info(
        "Config validated: %d sources (%d enabled), output -> %s",
        len(config.sources),
        len(enabled),
        config.output.base_dir,
    )
