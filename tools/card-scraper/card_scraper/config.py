"""Multi-game YAML configuration loader and validation."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


import yaml

from card_scraper.adapters import known_adapters

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
    bulk_ttl_hours: int = 24
    image_size: str = "normal"


@dataclass
class OutputConfig:
    """Output directory and format settings."""

    base_dir: str = "./output/"
    image_format: str = "original"
    manifest_version: str = "1.0"


@dataclass
class ScrapeConfig:
    """What to scrape."""

    sets: str = "all"  # "all" or comma-separated set IDs
    categories: Optional[List[str]] = None  # MTG: ["core", "expansion", "commander"]
    include_starters: bool = True
    include_tokens: bool = False


@dataclass
class StateConfig:
    """State persistence settings."""

    state_file: str = "./state/scrape-state.json"


@dataclass
class GameConfig:
    """Configuration for a single game."""

    sources: List[SourceConfig] = field(default_factory=list)
    scrape: ScrapeConfig = field(default_factory=ScrapeConfig)

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


@dataclass
class AppConfig:
    """Top-level application configuration."""

    game: str = "onepiece"  # Default game to scrape
    games: Dict[str, GameConfig] = field(default_factory=dict)
    output: OutputConfig = field(default_factory=OutputConfig)
    state: StateConfig = field(default_factory=StateConfig)

    def __post_init__(self) -> None:
        if not self.games:
            self.games = {
                "onepiece": GameConfig(
                    sources=[
                        SourceConfig(name="optcg-api", priority=1, rate_limit_ms=200),
                        SourceConfig(name="ryan-api", priority=2, rate_limit_ms=500),
                        SourceConfig(name="vegapull-records", priority=3, local_path="./data/vegapull-records/"),
                    ],
                ),
            }

    @property
    def output_dir(self) -> str:
        """Return the game-qualified output directory: base_dir/game."""
        return str(Path(self.output.base_dir) / self.game)

    @property
    def active_game(self) -> GameConfig:
        """Return the GameConfig for the currently selected game."""
        return self.games[self.game]

    @property
    def sources(self) -> List[SourceConfig]:
        """Backwards-compatible: return sources for the active game."""
        return self.active_game.sources

    @property
    def enabled_sources(self) -> List[SourceConfig]:
        """Return enabled sources for the active game, sorted by priority."""
        return self.active_game.enabled_sources

    @property
    def scrape(self) -> ScrapeConfig:
        """Return scrape config for the active game."""
        return self.active_game.scrape

    @property
    def set_filter(self) -> Optional[List[str]]:
        """Return set filter for the active game."""
        return self.active_game.set_filter


def load_config(path: Optional[Path] = None, game: Optional[str] = None) -> AppConfig:
    """Load configuration from a YAML file, falling back to defaults."""
    config_path = path or DEFAULT_CONFIG_PATH
    if not config_path.exists():
        logger.info("No config file at %s, using defaults", config_path)
        config = AppConfig()
    else:
        logger.info("Loading config from %s", config_path)
        with open(config_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        config = _parse_config(raw) if raw else AppConfig()

    # CLI game override
    if game:
        config.game = game

    _validate_config(config)
    return config


def _parse_config(raw: Dict[str, Any]) -> AppConfig:
    """Parse raw YAML dict into AppConfig."""
    config = AppConfig()

    # Default game
    if "game" in raw:
        config.game = str(raw["game"])

    # Multi-game config
    if "games" in raw:
        config.games = {}
        for game_name, game_raw in raw["games"].items():
            config.games[game_name] = _parse_game_config(game_raw)
    elif "sources" in raw:
        # Legacy single-game format: treat as onepiece
        config.games = {
            "onepiece": _parse_game_config(raw),
        }

    # Output
    if "output" in raw:
        out = raw["output"]
        config.output = OutputConfig(
            base_dir=out.get("base_dir", config.output.base_dir),
            image_format=out.get("image_format", config.output.image_format),
            manifest_version=out.get("manifest_version", config.output.manifest_version),
        )

    # State
    if "state" in raw:
        st = raw["state"]
        config.state = StateConfig(
            state_file=st.get("state_file", config.state.state_file),
        )

    return config


def _parse_game_config(raw: Dict[str, Any]) -> GameConfig:
    """Parse a game-specific config block."""
    gc = GameConfig()

    if "sources" in raw:
        gc.sources = []
        for src in raw["sources"]:
            gc.sources.append(
                SourceConfig(
                    name=src["name"],
                    enabled=src.get("enabled", True),
                    priority=src.get("priority", 99),
                    rate_limit_ms=src.get("rate_limit_ms", 200),
                    local_path=src.get("local_path"),
                    bulk_ttl_hours=src.get("bulk_ttl_hours", 24),
                    image_size=src.get("image_size", "normal"),
                )
            )

    if "scrape" in raw:
        scr = raw["scrape"]
        gc.scrape = ScrapeConfig(
            sets=str(scr.get("sets", "all")),
            categories=scr.get("categories"),
            include_starters=scr.get("include_starters", True),
            include_tokens=scr.get("include_tokens", False),
        )

    return gc


def _validate_config(config: AppConfig) -> None:
    """Validate config and raise on errors."""
    if config.game not in config.games:
        raise ValueError(
            f"Config error: active game '{config.game}' not found in games config. "
            f"Available: {list(config.games.keys())}"
        )

    game_cfg = config.active_game
    if not game_cfg.sources:
        raise ValueError(f"Config error: no sources defined for game '{config.game}'")

    names = [s.name for s in game_cfg.sources]
    if len(names) != len(set(names)):
        raise ValueError(f"Config error: duplicate source names in game '{config.game}'")

    known = known_adapters(config.game)
    for src in game_cfg.sources:
        if src.name not in known:
            raise ValueError(
                f"Config error: unknown source '{src.name}' for game '{config.game}'. "
                f"Known: {known}"
            )

    enabled = game_cfg.enabled_sources
    if not enabled:
        raise ValueError(f"Config error: no enabled sources for game '{config.game}'")

    logger.info(
        "Config validated: game=%s, %d sources (%d enabled), output -> %s",
        config.game,
        len(game_cfg.sources),
        len(enabled),
        config.output.base_dir,
    )
