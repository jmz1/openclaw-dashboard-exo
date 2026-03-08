"""
Parse extension telemetry JSONL event files for EXO and remembrall.

Provides aggregation and correlation functions for dashboard statistics.

v7: EXO events use blockType (0=deny, 1=gate, 2=detent) instead of severity.
    No rule_warned event type — all rules block.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


UTC = timezone.utc

BLOCK_TYPE_NAMES = {0: "deny", 1: "gate", 2: "detent"}

# Set via set_workspace_root() so paths can be displayed workspace-relative.
_workspace_root: str = ""


def set_workspace_root(root: str) -> None:
    """Set the workspace root for path shortening in display output."""
    global _workspace_root
    _workspace_root = root.rstrip("/") + "/" if root else ""


def _shorten_path(path: str) -> str:
    """Strip workspace root prefix from a path for display."""
    if _workspace_root and isinstance(path, str) and path.startswith(_workspace_root):
        return path[len(_workspace_root):]
    return path


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    """Load a JSONL file, skipping malformed lines."""
    if not path.exists():
        return []
    events = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def _load_jsonl_dir(directory: Path, days: int = 30) -> list[dict[str, Any]]:
    """Load all JSONL files from a directory within the last N days."""
    if not directory.exists():
        return []

    cutoff = datetime.now(UTC) - timedelta(days=days)
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    all_events = []

    for path in sorted(directory.glob("*.jsonl")):
        date_str = path.stem  # YYYY-MM-DD
        if date_str >= cutoff_str:
            all_events.extend(_load_jsonl(path))

    return all_events


def load_exo_events(telemetry_dir: str | Path, days: int = 30) -> list[dict[str, Any]]:
    """Load EXO telemetry events."""
    return _load_jsonl_dir(Path(telemetry_dir) / "exo", days)


def load_objection_events(telemetry_dir: str | Path, days: int = 30) -> list[dict[str, Any]]:
    """Load EXO objection events."""
    return _load_jsonl_dir(Path(telemetry_dir) / "exo" / "objections", days)


def aggregate_objection_stats(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate objection events into dashboard statistics."""
    by_rule: dict[str, int] = defaultdict(int)
    daily: dict[str, int] = defaultdict(int)

    for event in events:
        block = event.get("block", {})
        rule = block.get("rule", "unknown")
        by_rule[rule] += 1
        ts = event.get("ts", "")
        day = ts[:10] if ts else "unknown"
        daily[day] += 1

    sorted_events = sorted(events, key=lambda e: e.get("ts", ""))

    return {
        "total": len(events),
        "by_rule": dict(by_rule),
        "daily": dict(daily),
        "events": sorted_events[-50:],
    }


def load_remembrall_events(telemetry_dir: str | Path, days: int = 30) -> list[dict[str, Any]]:
    """Load remembrall telemetry events."""
    return _load_jsonl_dir(Path(telemetry_dir) / "remembrall", days)


def load_toollog_events(telemetry_dir: str | Path, days: int = 30) -> list[dict[str, Any]]:
    """Load toollog events from telemetry/toollog/."""
    return _load_jsonl_dir(Path(telemetry_dir) / "toollog", days)


# ============================================================================
# EXO Aggregations
# ============================================================================


def aggregate_exo_stats(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate EXO events into dashboard statistics."""
    rule_matches: dict[str, int] = defaultdict(int)
    rule_blocks: dict[str, int] = defaultdict(int)
    rule_satisfied: dict[str, int] = defaultdict(int)
    detector_recordings: dict[str, int] = defaultdict(int)
    daily_activity: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    # Block type breakdown
    blocks_by_type: dict[str, int] = defaultdict(int)
    total_matches = 0

    for event in events:
        event_type = event.get("type", "")
        ts = event.get("ts", "")
        day = ts[:10] if ts else "unknown"

        if event_type == "rule_match":
            rule_name = event.get("rule", "unknown")
            rule_matches[rule_name] += 1
            daily_activity[day]["matches"] += 1
            total_matches += 1

        elif event_type == "rule_blocked":
            rule_name = event.get("rule", "unknown")
            rule_blocks[rule_name] += 1
            daily_activity[day]["blocks"] += 1
            # Track by block type
            bt = event.get("blockType")
            if bt is not None:
                type_name = BLOCK_TYPE_NAMES.get(bt, f"type_{bt}")
                blocks_by_type[type_name] += 1

        elif event_type == "rule_satisfied":
            rule_name = event.get("rule", "unknown")
            rule_satisfied[rule_name] += 1
            daily_activity[day]["satisfied"] += 1

        elif event_type == "detector_recorded":
            for det in event.get("detectors", []):
                detector_recordings[det] += 1
            daily_activity[day]["detectors"] += 1

    # Sort by timestamp so the feed is chronological regardless of file load order
    sorted_events = sorted(events, key=lambda e: e.get("ts", ""))

    return {
        "total_events": total_matches,
        "rule_matches": dict(rule_matches),
        "rule_blocks": dict(rule_blocks),
        "rule_satisfied": dict(rule_satisfied),
        "blocks_by_type": dict(blocks_by_type),
        "detector_recordings": dict(detector_recordings),
        "daily_activity": {
            day: dict(counts) for day, counts in sorted(daily_activity.items())
        },
        "events": sorted_events[-100:],  # last 100 for live feed
    }


# ============================================================================
# Remembrall Aggregations
# ============================================================================


def correlate_remembrall_with_toollog(
    remembrall_events: list[dict[str, Any]],
    toollog_events: list[dict[str, Any]],
    window_minutes: int = 10,
) -> list[dict[str, Any]]:
    """
    Correlate remembrall activations with subsequent write/edit tool calls.

    For each remembrall activation, look for Write/edit calls in the same
    session within the time window. Returns enriched activation records.
    """
    write_tools = {"Write", "write", "Edit", "edit"}

    session_writes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in toollog_events:
        if event.get("tool") in write_tools:
            session = event.get("session", "")
            if session:
                session_writes[session].append(event)

    enriched = []
    for event in remembrall_events:
        entry = {**event}
        event_type = event.get("type", "")

        if event_type == "activation":
            session = event.get("session", "")
            ts_str = event.get("ts", "")
            subsequent_writes: list[dict[str, str]] = []

            if ts_str and session:
                try:
                    activation_time = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    window_end = activation_time + timedelta(minutes=window_minutes)

                    for write_event in session_writes.get(session, []):
                        write_ts_str = write_event.get("ts", "")
                        if not write_ts_str:
                            continue
                        write_time = datetime.fromisoformat(write_ts_str.replace("Z", "+00:00"))
                        if activation_time < write_time <= window_end:
                            params = write_event.get("params", {})
                            path = params.get("file_path") or params.get("path") or "unknown"
                            path = _shorten_path(path)
                            subsequent_writes.append({
                                "path": path,
                                "tool": write_event.get("tool", ""),
                                "ts": write_ts_str,
                            })
                except (ValueError, TypeError):
                    pass

            entry["subsequent_writes"] = subsequent_writes
            entry["resolved"] = len(subsequent_writes) > 0

        enriched.append(entry)

    return enriched


def aggregate_remembrall_stats(
    enriched_events: list[dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate enriched remembrall events into dashboard statistics."""
    activations = [e for e in enriched_events if e.get("type") == "activation"]
    satisfied = [e for e in enriched_events if e.get("type") == "pattern_satisfied"]
    resolved = [e for e in activations if e.get("resolved")]
    unresolved = [e for e in activations if not e.get("resolved")]

    pattern_freq: dict[str, int] = defaultdict(int)
    for event in enriched_events:
        for p in event.get("patterns", []):
            pattern_freq[p] += 1

    write_destinations: dict[str, int] = defaultdict(int)
    for event in resolved:
        for w in event.get("subsequent_writes", []):
            write_destinations[w["path"]] += 1
    for event in satisfied:
        for path in event.get("writeTargets", []):
            write_destinations[_shorten_path(path)] += 1

    daily: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for event in enriched_events:
        ts = event.get("ts", "")
        day = ts[:10] if ts else "unknown"
        event_type = event.get("type", "")
        if event_type == "activation":
            daily[day]["activations"] += 1
            if event.get("resolved"):
                daily[day]["resolved"] += 1
            else:
                daily[day]["unresolved"] += 1
        elif event_type == "pattern_satisfied":
            daily[day]["satisfied"] += 1

    # Sort by timestamp so the feed is chronological regardless of file load order
    sorted_enriched = sorted(enriched_events, key=lambda e: e.get("ts", ""))

    return {
        "total_activations": len(activations),
        "total_satisfied": len(satisfied),
        "resolved_activations": len(resolved),
        "unresolved_activations": len(unresolved),
        "resolution_rate": (
            len(resolved) / len(activations) * 100 if activations else 0
        ),
        "pattern_frequency": dict(pattern_freq),
        "write_destinations": dict(write_destinations),
        "daily_activity": {
            day: dict(counts) for day, counts in sorted(daily.items())
        },
        "events": sorted_enriched[-50:],
    }
