"""
Parse memory/self-review.md into structured pattern data.

Extracts active and retired patterns with their TRIGGER/MISS/FIX fields,
cross-references with EXO rules via keywords.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


def _parse_pattern_block(block: str) -> dict[str, Any] | None:
    """Parse a single ### Pattern: block into structured data."""
    lines = block.strip().split("\n")
    if not lines:
        return None

    name = lines[0].strip()
    triggers: list[str] = []
    misses: list[str] = []
    fix = ""
    current_field: str | None = None
    current_lines: list[str] = []

    for line in lines[1:]:
        stripped = line.strip()

        if stripped.startswith("TRIGGER:"):
            if current_field == "fix":
                fix = "\n".join(current_lines).strip()
            current_field = "trigger"
            trigger_text = stripped.replace("TRIGGER:", "").strip()
            triggers = [t.strip().lower() for t in trigger_text.split(",") if t.strip()]
            current_lines = []

        elif re.match(r"^MISS\s*\d*:", stripped):
            if current_field == "fix":
                fix = "\n".join(current_lines).strip()
            current_field = "miss"
            miss_text = re.sub(r"^MISS\s*\d*:", "", stripped).strip()
            if miss_text:
                misses.append(miss_text)
            current_lines = []

        elif stripped.startswith("FIX:"):
            if current_field == "miss" and current_lines:
                misses[-1] += "\n" + "\n".join(current_lines).strip() if misses else None
            current_field = "fix"
            fix_text = stripped.replace("FIX:", "").strip()
            current_lines = [fix_text] if fix_text else []

        elif current_field == "fix":
            current_lines.append(line)

    if current_field == "fix" and current_lines:
        fix = "\n".join(current_lines).strip()

    if not name or not triggers:
        return None

    return {
        "name": name,
        "triggers": triggers,
        "misses": misses,
        "fix": fix,
    }


def _parse_retired_block(block: str) -> dict[str, Any] | None:
    """Parse a retired/consolidated pattern block."""
    lines = block.strip().split("\n")
    if not lines:
        return None

    # First line: name — CLASSIFICATION (date)
    header = lines[0].strip()
    match = re.match(r"^(.+?)\s*—\s*(\w+)\s*\((.+?)\)", header)
    if match:
        name = match.group(1).strip()
        classification = match.group(2).strip()
        date = match.group(3).strip()
    else:
        name = header
        classification = "UNKNOWN"
        date = ""

    description = "\n".join(line.strip() for line in lines[1:]).strip()

    return {
        "name": name,
        "classification": classification,
        "date": date,
        "description": description,
    }


def parse_self_review(path: str | Path) -> dict[str, Any]:
    """Parse self-review.md into structured data."""
    path = Path(path)
    if not path.exists():
        return {"active": [], "retired": [], "maintenance_log": [], "error": "File not found"}

    content = path.read_text()

    # Split into sections
    active_patterns: list[dict[str, Any]] = []
    retired_patterns: list[dict[str, Any]] = []
    maintenance_log: list[dict[str, str]] = []

    # Extract active patterns
    active_section = re.search(
        r"## Active Patterns\s*\n(.*?)(?=\n## |\Z)",
        content,
        re.DOTALL,
    )
    if active_section:
        blocks = re.split(r"\n### Pattern:", active_section.group(1))
        for block in blocks[1:]:  # skip text before first pattern
            pattern = _parse_pattern_block(block)
            if pattern:
                active_patterns.append(pattern)

    # Extract retired patterns
    retired_section = re.search(
        r"## Retired/Consolidated Patterns\s*\n(.*?)(?=\n## |\Z)",
        content,
        re.DOTALL,
    )
    if retired_section:
        blocks = re.split(r"\n### ", retired_section.group(1))
        for block in blocks[1:]:
            pattern = _parse_retired_block(block)
            if pattern:
                retired_patterns.append(pattern)

    # Extract maintenance log
    log_section = re.search(
        r"## Maintenance Log\s*\n(.*?)(?=\n## |\Z)",
        content,
        re.DOTALL,
    )
    if log_section:
        for match in re.finditer(
            r"\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|",
            log_section.group(1),
        ):
            date_str, action = match.groups()
            if date_str != "Date":  # skip header
                maintenance_log.append({"date": date_str, "action": action.strip()})

    return {
        "active": active_patterns,
        "retired": retired_patterns,
        "maintenance_log": maintenance_log,
    }
