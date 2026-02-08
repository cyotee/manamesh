"""CLI interface for the multi-game card scraper."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import shutil
import sys
from pathlib import Path
from typing import List, Optional

from rich.console import Console
from rich.logging import RichHandler
from rich.table import Table

from card_scraper.config import AppConfig, load_config
from card_scraper.manifest import validate_manifest
from card_scraper.scraper import Scraper
from card_scraper.state import StateTracker

console = Console()


def main(argv: Optional[List[str]] = None) -> None:
    """Entry point for the CLI."""
    parser = _build_parser()
    args = parser.parse_args(argv)

    # Set up logging
    level = logging.WARNING
    if args.verbose == 1:
        level = logging.INFO
    elif args.verbose >= 2:
        level = logging.DEBUG

    logging.basicConfig(
        level=level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[RichHandler(console=console, rich_tracebacks=True)],
    )

    if not hasattr(args, "func"):
        parser.print_help()
        return

    args.func(args)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="card-scraper",
        description="Multi-game card scraper and ManaMesh asset pack builder",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="count",
        default=0,
        help="Increase verbosity (-v info, -vv debug)",
    )
    parser.add_argument(
        "-c", "--config",
        type=Path,
        default=None,
        help="Path to config.yaml (default: config.yaml)",
    )
    parser.add_argument(
        "--game",
        type=str,
        default=None,
        help="Game to scrape: onepiece, mtg (overrides config default)",
    )

    subparsers = parser.add_subparsers(title="commands", dest="command")

    # scrape
    scrape_parser = subparsers.add_parser("scrape", help="Run the full scrape pipeline")
    scrape_parser.add_argument(
        "--sets",
        type=str,
        default=None,
        help="Comma-separated set IDs to scrape (e.g., OP-01,OP-02 or MKM,LCI)",
    )
    scrape_parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore state and re-scrape everything",
    )
    scrape_parser.set_defaults(func=_cmd_scrape)

    # status
    status_parser = subparsers.add_parser("status", help="Show scrape state")
    status_parser.set_defaults(func=_cmd_status)

    # validate
    validate_parser = subparsers.add_parser("validate", help="Validate generated manifests")
    validate_parser.set_defaults(func=_cmd_validate)

    # clean
    clean_parser = subparsers.add_parser("clean", help="Remove output and state files")
    clean_parser.set_defaults(func=_cmd_clean)

    return parser


def _load_app_config(args: argparse.Namespace) -> AppConfig:
    """Load config, applying CLI overrides."""
    game = getattr(args, "game", None)
    config = load_config(args.config, game=game)
    return config


# ------------------------------------------------------------------
# Command handlers
# ------------------------------------------------------------------


def _cmd_scrape(args: argparse.Namespace) -> None:
    config = _load_app_config(args)
    console.print(f"[bold]Game: {config.game}[/bold]")

    set_filter = None
    if args.sets:
        set_filter = [s.strip() for s in args.sets.split(",") if s.strip()]

    asyncio.run(_run_scrape(config, force=args.force, set_filter=set_filter))


async def _run_scrape(
    config: AppConfig,
    force: bool = False,
    set_filter: Optional[List[str]] = None,
) -> None:
    scraper = Scraper(config)
    try:
        await scraper.setup()
        await scraper.run(force=force, set_filter=set_filter)
    finally:
        await scraper.teardown()


def _cmd_status(args: argparse.Namespace) -> None:
    config = _load_app_config(args)
    tracker = StateTracker(config.state.state_file)
    summary = tracker.summary()

    console.print(f"\n[bold]Scrape Status ({config.game})[/bold]\n")

    table = Table(title="Overview")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")
    table.add_row("Sets scraped", str(summary["sets_scraped"]))
    table.add_row("Total cards", str(summary["total_cards"]))
    table.add_row("Images downloaded", str(summary["images_downloaded"]))
    table.add_row("Images failed", str(summary["images_failed"]))
    console.print(table)

    if summary["sets"]:
        console.print()
        sets_table = Table(title="Per-Set Details")
        sets_table.add_column("Set", style="cyan")
        sets_table.add_column("Cards", justify="right")
        sets_table.add_column("Images OK", justify="right", style="green")
        sets_table.add_column("Images Failed", justify="right", style="red")
        sets_table.add_column("Last Scraped")

        for sid, info in sorted(summary["sets"].items()):
            sets_table.add_row(
                sid,
                str(info["cards"]),
                str(info["images_ok"]),
                str(info["images_failed"]),
                info["last_scraped"] or "never",
            )
        console.print(sets_table)


def _cmd_validate(args: argparse.Namespace) -> None:
    config = _load_app_config(args)
    output_dir = Path(config.output_dir)

    if not output_dir.exists():
        console.print(f"[red]Output directory {output_dir} does not exist[/red]")
        sys.exit(1)

    all_errors: List[str] = []

    root_manifest = output_dir / "manifest.json"
    if root_manifest.exists():
        data = json.loads(root_manifest.read_text(encoding="utf-8"))
        errors = validate_manifest(data, expected_game=config.game)
        if errors:
            for e in errors:
                all_errors.append(f"root manifest: {e}")
                console.print(f"  [red]ERROR[/red] {e}")
        else:
            console.print(f"  [green]OK[/green] {root_manifest}")

        for set_ref in data.get("sets", []):
            set_path = output_dir / set_ref["path"] / "manifest.json"
            if set_path.exists():
                set_data = json.loads(set_path.read_text(encoding="utf-8"))
                errors = validate_manifest(set_data, expected_game=config.game)
                if errors:
                    for e in errors:
                        all_errors.append(f"{set_ref['path']}: {e}")
                        console.print(f"  [red]ERROR[/red] {set_ref['path']}: {e}")
                else:
                    console.print(f"  [green]OK[/green] {set_path}")
            else:
                all_errors.append(f"{set_ref['path']}: manifest.json not found")
                console.print(f"  [yellow]MISSING[/yellow] {set_path}")
    else:
        all_errors.append("Root manifest.json not found")
        console.print(f"[red]Root manifest not found at {root_manifest}[/red]")

    if all_errors:
        console.print(f"\n[red]{len(all_errors)} validation error(s)[/red]")
        sys.exit(1)
    else:
        console.print("\n[green]All manifests valid![/green]")


def _cmd_clean(args: argparse.Namespace) -> None:
    config = _load_app_config(args)

    output_dir = Path(config.output_dir)
    state_file = Path(config.state.state_file)

    if output_dir.exists():
        shutil.rmtree(output_dir)
        console.print(f"Removed output directory: {output_dir}")
    else:
        console.print(f"Output directory not found: {output_dir}")

    if state_file.exists():
        state_file.unlink()
        console.print(f"Removed state file: {state_file}")
    else:
        console.print(f"State file not found: {state_file}")

    console.print("[green]Clean complete[/green]")
