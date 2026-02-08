"""Core scrape orchestrator — coordinates adapters, downloads, and manifests."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn

from card_scraper.adapters import CardSourceAdapter, get_adapter_class
from card_scraper.config import AppConfig, SourceConfig
from card_scraper.downloader import ImageDownloader
from card_scraper.models import CardDataBase, SetInfo
from card_scraper.state import StateTracker

logger = logging.getLogger(__name__)
console = Console()


# Game-specific manifest generators
def _get_manifest_generators(game: str):
    """Import and return the manifest generator functions for a game."""
    if game == "onepiece":
        from card_scraper.games.onepiece.manifest_template import (
            generate_onepiece_root_manifest,
            generate_onepiece_set_manifest,
        )
        return generate_onepiece_root_manifest, generate_onepiece_set_manifest
    elif game == "mtg":
        from card_scraper.games.mtg.manifest_template import (
            generate_mtg_root_manifest,
            generate_mtg_set_manifest,
        )
        return generate_mtg_root_manifest, generate_mtg_set_manifest
    else:
        raise ValueError(f"No manifest generators for game '{game}'")


class Scraper:
    """Orchestrates the full scrape pipeline:
    1. List sets from adapters (with fallback)
    2. Fetch card data per set (with fallback)
    3. Download images
    4. Generate manifests
    5. Update state
    """

    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._game = config.game
        self._adapters: List[CardSourceAdapter] = []
        self._state = StateTracker(config.state.state_file)
        self._downloader = ImageDownloader(
            config.output.base_dir,
            user_agent="ManaMesh-CardScraper/0.2",
        )

    async def setup(self) -> None:
        """Initialize adapters from config."""
        for src_cfg in self._config.enabled_sources:
            try:
                cls = get_adapter_class(self._game, src_cfg.name)
                adapter = _instantiate_adapter(cls, src_cfg)
                self._adapters.append(adapter)
                logger.info("Loaded adapter: %s (priority %d)", src_cfg.name, src_cfg.priority)
            except Exception as exc:
                logger.error("Failed to load adapter '%s': %s", src_cfg.name, exc)

        if not self._adapters:
            raise RuntimeError("No adapters could be loaded")

    async def teardown(self) -> None:
        """Clean up all adapters and the downloader."""
        for adapter in self._adapters:
            try:
                await adapter.close()
            except Exception:
                pass
        await self._downloader.close()

    async def run(self, force: bool = False, set_filter: Optional[List[str]] = None) -> None:
        """Execute the full scrape pipeline."""
        if force:
            console.print("[yellow]Force mode: ignoring previous state[/yellow]")
            self._state.reset()

        # 1. Discover sets
        console.print(f"\n[bold]Discovering sets for {self._game}...[/bold]")
        all_sets = await self._discover_sets()
        if not all_sets:
            console.print("[red]No sets found from any adapter[/red]")
            return

        # Apply filter
        filter_ids = set_filter or self._config.set_filter
        if filter_ids:
            filter_set = set(filter_ids)
            all_sets = [s for s in all_sets if s.id in filter_set]
            console.print(f"Filtered to {len(all_sets)} sets: {', '.join(s.id for s in all_sets)}")
        else:
            console.print(f"Found {len(all_sets)} sets")

        # 2. Fetch cards per set
        console.print("\n[bold]Fetching card data...[/bold]")
        all_cards: Dict[str, List[CardDataBase]] = {}

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Sets", total=len(all_sets))
            for set_info in all_sets:
                cards = await self._fetch_cards(set_info.id, force)
                if cards:
                    all_cards[set_info.id] = cards
                    for card in cards:
                        self._state.state.mark_card_scraped(set_info.id, card.id)
                    self._state.state.sets[set_info.id].last_scraped = (
                        datetime.now(timezone.utc).isoformat()
                    )
                progress.advance(task)

        total_cards = sum(len(c) for c in all_cards.values())
        console.print(f"Fetched {total_cards} cards across {len(all_cards)} sets")

        # 3. Download images (including multi-face for MTG)
        console.print("\n[bold]Downloading images...[/bold]")
        total_ok = 0
        total_fail = 0

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            for set_id, cards in all_cards.items():
                to_download = cards
                if not force:
                    to_download = [
                        c for c in cards
                        if not self._state.state.is_image_downloaded(set_id, c.id)
                    ]

                if not to_download:
                    continue

                task = progress.add_task(f"[cyan]{set_id}", total=len(to_download))

                def advance_cb(t=task):
                    progress.advance(t)

                ok, fail = await self._downloader.download_batch(
                    to_download,
                    get_url=self._get_best_image_url,
                    progress_callback=advance_cb,
                )

                for card in to_download:
                    if self._downloader.image_exists(set_id, card.id):
                        self._state.state.mark_image(
                            set_id, card.id, "success",
                            path=str(self._downloader.image_path(set_id, card.id)),
                        )
                    else:
                        self._state.state.mark_image(set_id, card.id, "failed")

                total_ok += ok
                total_fail += fail

        console.print(
            f"Images: [green]{total_ok} downloaded[/green], "
            f"[red]{total_fail} failed[/red]"
        )

        # 4. Generate manifests
        console.print("\n[bold]Generating manifests...[/bold]")
        gen_root, gen_set = _get_manifest_generators(self._game)
        sets_with_cards = [s for s in all_sets if s.id in all_cards]
        gen_root(
            self._config.output.base_dir,
            sets_with_cards,
            version=self._config.output.manifest_version,
        )
        for set_info in sets_with_cards:
            gen_set(
                self._config.output.base_dir,
                set_info,
                all_cards[set_info.id],
                version=self._config.output.manifest_version,
            )

        # 5. Save state
        self._state.save()
        console.print("\n[bold green]Scrape complete![/bold green]")

    def get_status(self) -> Dict:
        """Return current scrape state summary."""
        return self._state.summary()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _discover_sets(self) -> List[SetInfo]:
        """Try each adapter in priority order to discover sets."""
        all_sets: Dict[str, SetInfo] = {}

        for adapter in self._adapters:
            try:
                sets = await adapter.list_sets()
                for s in sets:
                    if s.id not in all_sets:
                        all_sets[s.id] = s
            except Exception as exc:
                logger.warning("Adapter %s failed to list sets: %s", adapter.name, exc)

        # Game-specific synthetic entries
        if self._game == "onepiece":
            scrape_cfg = self._config.scrape
            if scrape_cfg.include_starters:
                for i in range(1, 20):
                    sid = f"ST-{i:02d}"
                    if sid not in all_sets:
                        all_sets[sid] = SetInfo(id=sid, name=f"Starter Deck {i:02d}", category="starter")
            if scrape_cfg.include_promos:
                if "PROMO" not in all_sets:
                    all_sets["PROMO"] = SetInfo(id="PROMO", name="Promo Cards", category="promo")

        return sorted(all_sets.values(), key=lambda s: s.id)

    async def _fetch_cards(self, set_id: str, force: bool) -> List[CardDataBase]:
        """Fetch cards from adapters with fallback chain."""
        for adapter in self._adapters:
            try:
                cards = await adapter.get_cards(set_id)
                if cards:
                    seen: set = set()
                    unique: List[CardDataBase] = []
                    for card in cards:
                        if card.id not in seen:
                            seen.add(card.id)
                            unique.append(card)
                    if len(unique) < len(cards):
                        logger.info(
                            "Set %s: deduplicated %d -> %d cards",
                            set_id, len(cards), len(unique),
                        )
                    logger.info(
                        "Set %s: got %d cards from %s", set_id, len(unique), adapter.name
                    )
                    return unique
            except Exception as exc:
                logger.warning(
                    "Adapter %s failed for set %s: %s", adapter.name, set_id, exc
                )
        logger.warning("No cards found for set %s from any adapter", set_id)
        return []

    def _get_best_image_url(self, card: CardDataBase) -> str:
        """Get the best image URL using the adapter that provided the card."""
        for adapter in self._adapters:
            if adapter.name == card.source:
                return adapter.get_image_url(card)
        return card.image_url


def _instantiate_adapter(cls: type, cfg: SourceConfig) -> CardSourceAdapter:
    """Create an adapter instance with config-appropriate kwargs."""
    kwargs = {}
    if hasattr(cls.__init__, "__code__"):
        params = cls.__init__.__code__.co_varnames
        if "rate_limit_ms" in params:
            kwargs["rate_limit_ms"] = cfg.rate_limit_ms
        if "local_path" in params and cfg.local_path:
            kwargs["local_path"] = cfg.local_path
        if "bulk_ttl_hours" in params:
            kwargs["bulk_ttl_hours"] = cfg.bulk_ttl_hours
        if "image_size" in params:
            kwargs["image_size"] = cfg.image_size
    return cls(**kwargs)
