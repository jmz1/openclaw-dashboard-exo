"""
Server-side data providers — modular extensions for the EXO Dashboard.

Each provider is a Python module in this directory exporting a class that
implements the Provider protocol. Providers are auto-discovered and loaded
only when their required config keys are present.

Parallel to `dashboard/panels/custom/` on the frontend.
"""

from __future__ import annotations

import importlib
import logging
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from fastapi import FastAPI

logger = logging.getLogger("exo-dashboard.providers")


@runtime_checkable
class Provider(Protocol):
    """Interface that server-side data providers must implement.

    Providers supply data to custom dashboard panels. They are auto-discovered
    from this directory and loaded when all required config keys are present.
    """

    @property
    def id(self) -> str: ...

    @property
    def config_keys(self) -> tuple[str, ...]: ...

    def setup(self, paths: dict[str, str], config: dict[str, Any]) -> None:
        """Initialise with resolved config paths and full server config."""
        ...

    def refresh(self) -> None:
        """Refresh cached data from sources."""
        ...

    def data(self) -> dict[str, Any]:
        """Return current cached data."""
        ...

    def overview(self) -> dict[str, Any]:
        """Contribute a section to the /api/overview response."""
        ...

    def register_routes(self, app: FastAPI) -> None:
        """Register provider-specific API routes."""
        ...

    def watch_paths(self) -> tuple[str, ...]:
        """Return filesystem paths to watch for changes."""
        ...

    def periodic_tasks(self) -> tuple[tuple[int, str], ...]:
        """Return (interval_seconds, refresh_section_name) pairs.

        Each entry creates an asyncio task that calls refresh() at the interval
        and broadcasts a WebSocket event with the given section name.
        """
        ...


def _find_provider_class(module: object) -> type | None:
    """Find the provider class in a module (first class with id and config_keys)."""
    for attr_name in dir(module):
        attr = getattr(module, attr_name)
        if (
            isinstance(attr, type)
            and hasattr(attr, "id")
            and hasattr(attr, "config_keys")
            and attr_name != "Provider"
        ):
            return attr
    return None


def discover(
    paths: dict[str, str],
    config: dict[str, Any],
) -> dict[str, Provider]:
    """Auto-discover and load providers from this directory.

    Skips providers whose required config keys are absent.
    Returns mapping of provider id → initialised provider instance.
    """
    providers_dir = Path(__file__).parent
    loaded: dict[str, Provider] = {}

    for module_path in sorted(providers_dir.glob("*.py")):
        if module_path.name.startswith("_"):
            continue

        module_name = module_path.stem
        try:
            module = importlib.import_module(f"providers.{module_name}")
        except Exception as e:
            logger.warning("Failed to import provider %s: %s", module_name, e)
            continue

        provider_cls = _find_provider_class(module)
        if provider_cls is None:
            continue

        instance = provider_cls()
        missing = tuple(k for k in instance.config_keys if not paths.get(k))
        if missing:
            logger.info(
                "Skipping provider %s — missing config: %s",
                instance.id,
                ", ".join(missing),
            )
            continue

        try:
            instance.setup(paths, config)
            loaded[instance.id] = instance
            logger.info("Loaded provider: %s", instance.id)
        except Exception as e:
            logger.warning("Failed to setup provider %s: %s", instance.id, e)

    return loaded
