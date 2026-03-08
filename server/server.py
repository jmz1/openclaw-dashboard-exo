#!/usr/bin/env python3
"""
EXO Dashboard — Backend Server

FastAPI service providing REST API and WebSocket for the EXO dashboard.
Reads rules.yaml, self-review.md, toollog, and extension telemetry event files.
Watches for changes and pushes updates via WebSocket.

Usage:
    python server.py                    # default config
    python server.py --port 8768        # override port
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from watchfiles import awatch

import providers as provider_system
from parsers.rules import parse_rules_file
from parsers.self_review import parse_self_review
from parsers.cron_status import load_cron_status  # reads jobs.json directly
from parsers.ext_events import (
    aggregate_exo_stats,
    aggregate_objection_stats,
    load_exo_events,
    load_objection_events,
    set_workspace_root,
)

# ============================================================================
# Configuration
# ============================================================================

logger = logging.getLogger("exo-dashboard")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logging.getLogger("watchfiles.main").setLevel(logging.WARNING)

DEFAULT_CONFIG_PATH = Path(__file__).parent / "config.yaml"


def load_config(path: Path | None = None) -> dict[str, Any]:
    config_path = path or DEFAULT_CONFIG_PATH
    with open(config_path) as f:
        return yaml.safe_load(f)


def _resolve_config_path() -> Path:
    """Check for --config in sys.argv early (before argparse) so CONFIG is set at module level."""
    import sys
    for i, arg in enumerate(sys.argv):
        if arg == "--config" and i + 1 < len(sys.argv):
            return Path(sys.argv[i + 1])
    return DEFAULT_CONFIG_PATH


CONFIG = load_config(_resolve_config_path())
PATHS = CONFIG["paths"]
HISTORY_DAYS = CONFIG.get("history_days", 30)
DASHBOARD_CONFIG = CONFIG.get("dashboard", {})

# Workspace root for path shortening in display output (optional)
if CONFIG.get("workspace"):
    set_workspace_root(CONFIG["workspace"])

# ============================================================================
# Data Cache
# ============================================================================


class DataCache:
    """In-memory cache of parsed data, refreshed on file changes."""

    def __init__(self) -> None:
        self.rules: dict[str, Any] = {}
        self.self_review: dict[str, Any] = {}
        self.exo_stats: dict[str, Any] = {}
        self.objection_stats: dict[str, Any] = {}
        self.heartbeat_state: dict[str, Any] = {}
        self.cron_status: dict[str, Any] = {}
        self.providers: dict[str, provider_system.Provider] = {}
        self.last_refresh: float = 0

    def refresh_rules(self) -> None:
        logger.info("Refreshing rules data")
        self.rules = parse_rules_file(PATHS["rules"])

    def refresh_self_review(self) -> None:
        logger.info("Refreshing self-review data")
        self.self_review = parse_self_review(PATHS["self_review"])

    def refresh_exo_stats(self) -> None:
        logger.debug("Refreshing EXO stats")
        events = load_exo_events(PATHS["telemetry_dir"], HISTORY_DAYS)
        self.exo_stats = aggregate_exo_stats(events)

    def refresh_objection_stats(self) -> None:
        logger.debug("Refreshing objection stats")
        events = load_objection_events(PATHS["telemetry_dir"], HISTORY_DAYS)
        self.objection_stats = aggregate_objection_stats(events)

    def refresh_cron(self) -> None:
        cron_path = PATHS.get("cron_jobs", "")
        if not cron_path:
            return
        logger.debug("Refreshing cron status")
        self.cron_status = load_cron_status(cron_path)

    def refresh_heartbeat(self) -> None:
        path = Path(PATHS["heartbeat_state"])
        if path.exists():
            try:
                self.heartbeat_state = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                self.heartbeat_state = {}

    def refresh_all(self) -> None:
        self.refresh_rules()
        self.refresh_self_review()
        self.refresh_exo_stats()
        self.refresh_objection_stats()
        self.refresh_heartbeat()
        self.refresh_cron()
        for p in self.providers.values():
            try:
                p.refresh()
            except Exception as e:
                logger.warning("Provider %s refresh failed: %s", p.id, e)
        self.last_refresh = time.time()
        logger.info("Full data refresh complete")

    def overview(self) -> dict[str, Any]:
        """High-level system health overview."""
        rules = self.rules
        sr = self.self_review
        pf = self.exo_stats
        obj = self.objection_stats
        hb = self.heartbeat_state

        type_counts = rules.get("typeCounts", {})

        return {
            "exo": {
                "rules_count": len(rules.get("rules", [])),
                "detectors_count": len(rules.get("detectors", [])),
                "total_matches": pf.get("total_events", 0),
                "total_blocks": sum(pf.get("rule_blocks", {}).values()),
                "total_satisfied": sum(pf.get("rule_satisfied", {}).values()),
                "blocks_by_type": pf.get("blocks_by_type", {}),
                "type_counts": type_counts,
            },
            "objections": {
                "total": obj.get("total", 0),
                "by_rule": obj.get("by_rule", {}),
            },
            "self_review": {
                "active_patterns": len(sr.get("active", [])),
                "retired_patterns": len(sr.get("retired", [])),
            },
            "heartbeat": {
                "last_checks": hb.get("lastChecks", {}),
                "self_review_state": hb.get("selfReview", {}),
            },
            "cron": self.cron_status.get("counts", {}),
            **{k: v for p in self.providers.values() for k, v in p.overview().items()},
            "last_refresh": self.last_refresh,
        }


cache = DataCache()

# ============================================================================
# WebSocket Manager
# ============================================================================


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)
        logger.info(f"WebSocket connected ({len(self.active)} active)")

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)
        logger.info(f"WebSocket disconnected ({len(self.active)} active)")

    async def broadcast(self, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


ws_manager = ConnectionManager()

# ============================================================================
# File Watcher
# ============================================================================


async def watch_files() -> None:
    """Watch source files and refresh cache + push updates on changes."""
    watch_paths = [
        PATHS["rules"],
        PATHS["self_review"],
        PATHS["heartbeat_state"],
        PATHS.get("cron_jobs", ""),
    ]
    # Also watch telemetry dir (includes exo, remembrall, toollog subdirs)
    watch_dirs = [
        PATHS.get("telemetry_dir", ""),
    ]
    # Add provider watch paths
    for p in cache.providers.values():
        watch_dirs.extend(p.watch_paths())

    all_paths = [p for p in watch_paths + watch_dirs if p and Path(p).exists()]
    if not all_paths:
        logger.warning("No watch paths found")
        return

    logger.info(f"Watching {len(all_paths)} paths for changes")

    async for changes in awatch(*all_paths):
        changed_paths = {str(c[1]) for c in changes}
        logger.debug(f"Files changed: {changed_paths}")

        refresh_type = None

        for path in changed_paths:
            if "rules.yaml" in path or ("config/exo" in path and path.endswith((".yaml", ".yml"))):
                cache.refresh_rules()
                refresh_type = "rules"
            elif "self-review" in path:
                cache.refresh_self_review()
                refresh_type = "self_review"
            elif "heartbeat" in path:
                cache.refresh_heartbeat()
                refresh_type = "heartbeat"
            elif "telemetry/exo/objections" in path:
                cache.refresh_objection_stats()
                refresh_type = "objection_stats"
            elif "telemetry/exo" in path or "toollog" in path:
                cache.refresh_exo_stats()
                refresh_type = "exo_stats"
            elif "cron" in path and "jobs.json" in path:
                cache.refresh_cron()
                refresh_type = "cron"
            else:
                # Check provider watch paths
                for p in cache.providers.values():
                    if any(wp in path for wp in p.watch_paths()):
                        p.refresh()
                        refresh_type = p.id

        if refresh_type:
            await ws_manager.broadcast({
                "type": "refresh",
                "section": refresh_type,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })


# ============================================================================
# App Lifecycle
# ============================================================================


async def periodic_provider_refresh(
    provider: provider_system.Provider,
    interval: int,
    section: str,
) -> None:
    """Periodically refresh a provider and broadcast updates."""
    while True:
        await asyncio.sleep(interval)
        try:
            provider.refresh()
        except Exception as e:
            logger.warning("Periodic refresh failed for %s: %s", provider.id, e)
            continue
        await ws_manager.broadcast({
            "type": "refresh",
            "section": section,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Discover and load providers
    cache.providers = provider_system.discover(PATHS, CONFIG)
    for p in cache.providers.values():
        p.register_routes(app)

    # Startup
    cache.refresh_all()
    background_tasks: list[asyncio.Task[None]] = []
    background_tasks.append(asyncio.create_task(watch_files()))

    # Create periodic refresh tasks from providers
    for p in cache.providers.values():
        for interval, section in p.periodic_tasks():
            background_tasks.append(
                asyncio.create_task(periodic_provider_refresh(p, interval, section))
            )

    yield

    # Shutdown
    for task in background_tasks:
        task.cancel()
    await asyncio.gather(*background_tasks, return_exceptions=True)


# ============================================================================
# FastAPI App
# ============================================================================

app = FastAPI(title="EXO Dashboard", lifespan=lifespan)


class NoCacheMiddleware(BaseHTTPMiddleware):
    """Add no-cache headers to all responses for development."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if not request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        return response


app.add_middleware(NoCacheMiddleware)

# ── API Routes ──────────────────────────────────────────────────────────────


@app.get("/api/overview")
async def api_overview() -> JSONResponse:
    """System health overview."""
    return JSONResponse(cache.overview())


@app.get("/api/rules")
async def api_rules() -> JSONResponse:
    """EXO rules structure (for graph rendering)."""
    return JSONResponse(cache.rules)


@app.get("/api/self-review")
async def api_self_review() -> JSONResponse:
    """Self-review patterns."""
    return JSONResponse(cache.self_review)


@app.get("/api/exo/stats")
async def api_exo_stats() -> JSONResponse:
    """EXO firing statistics."""
    return JSONResponse(cache.exo_stats)


@app.get("/api/exo/objections")
async def api_exo_objections() -> JSONResponse:
    """EXO objection events."""
    return JSONResponse(cache.objection_stats)


@app.get("/api/cron")
async def api_cron() -> JSONResponse:
    """Cron job status and meta-process associations."""
    return JSONResponse(cache.cron_status)


@app.get("/api/dashboard/config")
async def api_dashboard_config() -> JSONResponse:
    """Dashboard panel configuration (from server config YAML)."""
    if not DASHBOARD_CONFIG:
        return JSONResponse(None, status_code=204)
    return JSONResponse(DASHBOARD_CONFIG)


@app.get("/api/heartbeat")
async def api_heartbeat() -> JSONResponse:
    """Heartbeat state."""
    return JSONResponse(cache.heartbeat_state)


@app.post("/api/refresh")
async def api_refresh() -> JSONResponse:
    """Force a full data refresh."""
    cache.refresh_all()
    await ws_manager.broadcast({
        "type": "refresh",
        "section": "all",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return JSONResponse({"status": "ok", "last_refresh": cache.last_refresh})


# ── WebSocket ───────────────────────────────────────────────────────────────


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws_manager.connect(ws)
    try:
        while True:
            # Keep connection alive; handle incoming messages if needed
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_json({"type": "pong"})
            elif data == "refresh":
                cache.refresh_all()
                await ws.send_json({
                    "type": "refresh",
                    "section": "all",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


# ── Static Files ────────────────────────────────────────────────────────────

DASHBOARD_DIR = Path(__file__).parent.parent / "dashboard"

if DASHBOARD_DIR.exists():
    # Serve static assets under explicit prefixes so they don't collide with /api/*.
    # In production, nginx serves these directly from the dashboard dir.
    for subdir in ["css", "js", "assets"]:
        sub_path = DASHBOARD_DIR / subdir
        if sub_path.exists():
            app.mount(f"/{subdir}", StaticFiles(directory=str(sub_path)), name=f"static-{subdir}")

    @app.get("/")
    async def index():
        return FileResponse(DASHBOARD_DIR / "index.html")

# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="EXO Dashboard Server")
    parser.add_argument("--config", type=str, help="Path to config YAML file")
    parser.add_argument("--port", type=int, default=CONFIG.get("port", 8768))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)
