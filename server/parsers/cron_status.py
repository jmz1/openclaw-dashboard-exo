"""
Cron job status parser.

Reads cron job state from the OpenClaw jobs.json file and enriches
with meta-process associations.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("exo-dashboard")

# Map cron job names → meta-process doc paths (relative to workspace)
META_PROCESS_MAP: dict[str, str] = {
    "self-review-weekly-maintenance": "meta/process/self-review-reflection.md",
    "multiagent-weekly-review": "meta/process/multiagent-review.md",
    "memory-distill-weekly": "meta/process/memory-distillation.md",
    "coherence-audit-weekly": "meta/process/coherence-audit.md",
}


def load_cron_status(cron_jobs_path: str) -> dict[str, Any]:
    """Load and structure cron job data for the dashboard."""
    jobs = _read_jobs_file(cron_jobs_path)

    enriched: list[dict[str, Any]] = []
    for job in jobs:
        name = job.get("name", "unnamed")
        state = job.get("state", {})
        schedule = job.get("schedule", {})
        enabled = job.get("enabled", True)

        # Human-readable schedule
        sched_str = _format_schedule(schedule)

        # Meta-process link
        meta_process = META_PROCESS_MAP.get(name, "")

        enriched.append({
            "id": job.get("id", ""),
            "name": name,
            "enabled": enabled,
            "schedule": sched_str,
            "schedule_raw": schedule,
            "session_target": job.get("sessionTarget", ""),
            "meta_process": meta_process,
            "last_run_at": state.get("lastRunAtMs"),
            "last_status": state.get("lastStatus", ""),
            "last_duration_ms": state.get("lastDurationMs"),
            "next_run_at": state.get("nextRunAtMs"),
            "consecutive_errors": state.get("consecutiveErrors", 0),
            "last_delivered": state.get("lastDelivered"),
            "last_delivery_status": state.get("lastDeliveryStatus", ""),
        })

    # Sort: enabled first, then by next run time
    enriched.sort(key=lambda j: (not j["enabled"], j.get("next_run_at") or float("inf")))

    active_count = sum(1 for j in enriched if j["enabled"])
    errored_count = sum(1 for j in enriched if j["consecutive_errors"] > 0)
    with_process = sum(1 for j in enriched if j["meta_process"])

    return {
        "jobs": enriched,
        "counts": {
            "total": len(enriched),
            "active": active_count,
            "disabled": len(enriched) - active_count,
            "errored": errored_count,
            "with_process": with_process,
        },
    }


def _read_jobs_file(path: str) -> list[dict[str, Any]]:
    """Read the OpenClaw cron jobs.json file."""
    p = Path(path)
    if not p.exists():
        logger.warning(f"Cron jobs file not found: {path}")
        return []
    try:
        data = json.loads(p.read_text())
        return data.get("jobs", []) if isinstance(data, dict) else data
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Failed to read cron jobs: {e}")
        return []


def _format_schedule(schedule: dict[str, Any]) -> str:
    """Convert schedule object to a human-readable string."""
    kind = schedule.get("kind", "")

    if kind == "cron":
        expr = schedule.get("expr", "")
        tz = schedule.get("tz", "")
        return _cron_to_human(expr, tz)
    elif kind == "every":
        ms = schedule.get("everyMs", 0)
        return _ms_to_human(ms)
    elif kind == "at":
        at = schedule.get("at", "")
        return f"once at {at[:16]}" if at else "once"
    return kind


def _cron_to_human(expr: str, tz: str = "") -> str:
    """Best-effort human-readable cron expression."""
    parts = expr.split()
    if len(parts) != 5:
        return expr

    minute, hour, dom, month, dow = parts
    tz_label = f" {tz.split('/')[-1]}" if tz else ""

    # Daily
    if dom == "*" and month == "*" and dow == "*":
        return f"daily {hour}:{minute.zfill(2)}{tz_label}"

    # Weekly (dow specified)
    if dom == "*" and month == "*" and dow != "*":
        day_names = {
            "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed",
            "4": "Thu", "5": "Fri", "6": "Sat", "7": "Sun",
        }
        day = day_names.get(dow, dow)
        return f"{day} {hour}:{minute.zfill(2)}{tz_label}"

    return f"{expr}{tz_label}"


def _ms_to_human(ms: int) -> str:
    """Convert milliseconds to a human-readable interval."""
    if ms < 60_000:
        return f"every {ms // 1000}s"
    if ms < 3_600_000:
        return f"every {ms // 60_000}m"
    if ms < 86_400_000:
        h = ms / 3_600_000
        return f"every {h:.0f}h" if h == int(h) else f"every {h:.1f}h"
    d = ms / 86_400_000
    return f"every {d:.0f}d" if d == int(d) else f"every {d:.1f}d"
