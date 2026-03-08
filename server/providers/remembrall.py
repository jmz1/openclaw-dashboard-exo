"""
Remembrall data provider for the EXO Dashboard.

Aggregates remembrall activation telemetry, correlates with toollog write events,
and provides resolution statistics.

This provider serves as a reference example for writing custom providers.

Config keys:
    telemetry_dir: Path to the telemetry directory (shared with core EXO stats)
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from parsers.ext_events import (
    aggregate_remembrall_stats,
    correlate_remembrall_with_toollog,
    load_remembrall_events,
    load_toollog_events,
)

logger = logging.getLogger("exo-dashboard.providers.remembrall")


class RemembrallProvider:
    """Remembrall activation history, write destinations, pattern frequency."""

    id = "remembrall"
    config_keys = ("telemetry_dir",)

    def __init__(self) -> None:
        self._telemetry_dir: str = ""
        self._history_days: int = 30
        self._cache: dict[str, Any] = {}

    def setup(self, paths: dict[str, str], config: dict[str, Any]) -> None:
        self._telemetry_dir = paths["telemetry_dir"]
        self._history_days = config.get("history_days", 30)

    def refresh(self) -> None:
        logger.debug("Refreshing remembrall stats")
        remembrall_events = load_remembrall_events(self._telemetry_dir, self._history_days)
        toollog_events = load_toollog_events(self._telemetry_dir, self._history_days)
        enriched = correlate_remembrall_with_toollog(remembrall_events, toollog_events)
        self._cache = aggregate_remembrall_stats(enriched)

    def data(self) -> dict[str, Any]:
        return self._cache

    def overview(self) -> dict[str, Any]:
        return {
            "remembrall": {
                "total_activations": self._cache.get("total_activations", 0),
                "total_satisfied": self._cache.get("total_satisfied", 0),
                "resolution_rate": self._cache.get("resolution_rate", 0),
                "unresolved": self._cache.get("unresolved_activations", 0),
            },
        }

    def register_routes(self, app: FastAPI) -> None:
        @app.get("/api/remembrall/stats")
        async def api_remembrall_stats() -> JSONResponse:
            """Remembrall activation statistics."""
            return JSONResponse(self._cache)

    def watch_paths(self) -> tuple[str, ...]:
        return (f"{self._telemetry_dir}/remembrall",)

    def periodic_tasks(self) -> tuple[tuple[int, str], ...]:
        return ()
