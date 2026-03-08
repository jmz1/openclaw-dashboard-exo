"""
Parse EXO rules.yaml into structured data for the dashboard API.

Converts the YAML rule/detector/staleness definitions into JSON-serialisable
dicts with the full condition tree preserved for graph rendering.

Three blocking modes via allowConditions:
  - deny (omitted / none: true) — unconditional permanent block
  - gate (detectors/grep) — preparation-gated block
  - detent (message: true) — agent sees warning and retries
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def parse_condition(condition: dict[str, Any]) -> dict[str, Any]:
    """Convert a ParamCondition dict into a graph-friendly node structure."""
    node: dict[str, Any] = {"type": "condition"}

    if "contains" in condition:
        node["op"] = "contains"
        node["value"] = condition["contains"]
    elif "containsAny" in condition:
        node["op"] = "containsAny"
        node["values"] = condition["containsAny"]
    elif "containsAll" in condition:
        node["op"] = "containsAll"
        node["values"] = condition["containsAll"]
    elif "pattern" in condition:
        node["op"] = "pattern"
        node["value"] = condition["pattern"]
    elif "fileContains" in condition:
        node["op"] = "fileContains"
        node["child"] = parse_condition(condition["fileContains"])

    # Composite operators
    if "all" in condition:
        node["op"] = "all"
        node["children"] = [parse_condition(c) for c in condition["all"]]
    if "none" in condition:
        if "op" not in node:
            node["op"] = "none"
        else:
            node = {
                "type": "condition",
                "op": "all",
                "children": [
                    node,
                    {
                        "type": "condition",
                        "op": "none",
                        "children": [parse_condition(c) for c in condition["none"]],
                    },
                ],
            }
            return node
        node["children"] = [parse_condition(c) for c in condition["none"]]

    return node


def parse_params(params: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Convert params dict into a list of param condition nodes."""
    if not params:
        return []

    result = []
    for key, condition in params.items():
        result.append({
            "param": key,
            "condition": parse_condition(condition),
        })
    return result


def _classify_block_type(allow_cond: dict[str, Any] | None) -> str:
    """Classify a rule's blocking mode from its allowConditions.

    Returns: "deny", "gate", or "detent"
    """
    if not allow_cond:
        return "deny"
    if allow_cond.get("none") is True:
        return "deny"
    if allow_cond.get("message") is True:
        return "detent"
    if any(allow_cond.get(k) for k in ("grep", "require", "anyOf", "allOf")):
        return "gate"
    return "deny"


def parse_rule(rule: dict[str, Any]) -> dict[str, Any]:
    """Parse a single rule into a graph-friendly structure."""
    allow_cond = rule.get("allowConditions") or {}
    block_type = _classify_block_type(allow_cond)

    # Resolve detector references
    ac_detectors: list[str] = []
    ac_mode = "any"  # default mode

    if block_type == "gate":
        if "require" in allow_cond:
            ac_detectors = [allow_cond["require"]]
        elif "anyOf" in allow_cond:
            ac_detectors = allow_cond["anyOf"]
        elif "allOf" in allow_cond:
            ac_detectors = allow_cond["allOf"]
            ac_mode = "all"
        # grep: true generates a detector at runtime — include a marker
        if allow_cond.get("grep"):
            slug = rule.get("name", "unnamed").lower().replace(" ", "-")
            slug = "".join(c for c in slug if c.isalnum() or c == "-").strip("-")
            ac_detectors.append(f"grep:{slug}")
    elif block_type == "detent":
        slug = rule.get("name", "unnamed").lower().replace(" ", "-")
        slug = "".join(c for c in slug if c.isalnum() or c == "-").strip("-")
        ac_detectors = [f"message:{slug}"]

    tool = rule.get("tool", "")
    if isinstance(tool, str):
        tool = [tool]

    return {
        "name": rule.get("name", "Unnamed"),
        "description": rule.get("description", ""),
        "tools": tool,
        "blockType": block_type,
        "keywords": rule.get("keywords", []),
        "blockMessage": rule.get("blockMessage"),
        "params": parse_params(rule.get("params")),
        "allowConditions": {
            "mode": ac_mode,
            "detectors": ac_detectors,
            "hasGrep": bool(allow_cond.get("grep")),
            "hasMessage": bool(allow_cond.get("message")),
        },
    }


def parse_detector(name: str, detector: dict[str, Any]) -> dict[str, Any]:
    """Parse a single detector definition."""
    tool = detector.get("tool", "")
    if isinstance(tool, str):
        tool = [tool]

    return {
        "id": name,
        "description": detector.get("description", ""),
        "tools": tool,
        "params": parse_params(detector.get("params")),
    }


def _parse_single_yaml(path: Path) -> dict[str, Any] | None:
    """Load and parse a single YAML file, returning raw data or None."""
    try:
        with open(path) as f:
            data = yaml.safe_load(f)
        return data if data else None
    except (OSError, yaml.YAMLError):
        return None


def _merge_rules_data(files: list[Path]) -> dict[str, Any]:
    """Merge multiple YAML rule files (matching EXO extension logic)."""
    merged_rules: list[dict[str, Any]] = []
    merged_detectors: dict[str, dict[str, Any]] = {}
    merged_staleness: dict[str, Any] = {}
    source_files: list[str] = []

    for f in sorted(files):
        data = _parse_single_yaml(f)
        if not data:
            continue
        source_files.append(str(f))

        if "rules" in data:
            merged_rules.extend(data["rules"])
        if "detectors" in data:
            merged_detectors.update(data["detectors"])
        if "staleness" in data:
            merged_staleness.update(data["staleness"])

    return {
        "rules": merged_rules,
        "detectors": merged_detectors,
        "staleness": merged_staleness,
        "source_files": source_files,
    }


def parse_rules_file(path: str | Path) -> dict[str, Any]:
    """Parse EXO rules into a dashboard-ready structure.

    Accepts either a single YAML file or a directory of YAML files.
    """
    path = Path(path)
    if not path.exists():
        return {"rules": [], "detectors": [], "staleness": {}, "error": "File not found"}

    if path.is_dir():
        yaml_files = sorted(
            p for p in path.iterdir()
            if p.suffix in (".yaml", ".yml") and p.is_file()
        )
        if not yaml_files:
            return {"rules": [], "detectors": [], "staleness": {}, "error": "No YAML files in directory"}
        raw = _merge_rules_data(yaml_files)
    else:
        data = _parse_single_yaml(path)
        if not data:
            return {"rules": [], "detectors": [], "staleness": {}}
        raw = {
            "rules": data.get("rules", []),
            "detectors": data.get("detectors", {}),
            "staleness": data.get("staleness", {}),
            "source_files": [str(path)],
        }

    rules = [parse_rule(r) for r in raw["rules"]]
    detectors = [
        parse_detector(name, det)
        for name, det in raw["detectors"].items()
    ]

    # Summary counts by block type
    type_counts = {"deny": 0, "gate": 0, "detent": 0}
    for r in rules:
        type_counts[r["blockType"]] = type_counts.get(r["blockType"], 0) + 1

    return {
        "rules": rules,
        "detectors": detectors,
        "staleness": raw["staleness"],
        "source_files": raw.get("source_files", []),
        "typeCounts": type_counts,
    }
