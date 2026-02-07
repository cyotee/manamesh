"""Adapter registry for card data sources."""

from __future__ import annotations

from typing import Dict, Type

from onepiece_scraper.adapters.base import CardSourceAdapter

# Lazy-loaded adapter registry: name -> module.ClassName
_ADAPTER_CLASSES: Dict[str, str] = {
    "optcg-api": "onepiece_scraper.adapters.optcg_api.OptcgApiAdapter",
    "ryan-api": "onepiece_scraper.adapters.ryan_api.RyanApiAdapter",
    "vegapull-records": "onepiece_scraper.adapters.vegapull_records.VegapullRecordsAdapter",
}


def get_adapter_class(name: str) -> Type[CardSourceAdapter]:
    """Import and return the adapter class for the given source name."""
    qualified = _ADAPTER_CLASSES.get(name)
    if qualified is None:
        raise ValueError(
            f"Unknown adapter '{name}'. Available: {list(_ADAPTER_CLASSES.keys())}"
        )
    module_path, class_name = qualified.rsplit(".", 1)
    import importlib

    module = importlib.import_module(module_path)
    return getattr(module, class_name)
