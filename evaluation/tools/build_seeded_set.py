#!/usr/bin/env python3
"""Generate Seeded set from Gold set using mutation catalog.

Usage:
  python evaluation/tools/build_seeded_set.py \
    --gold evaluation/data/gold_pr_set.jsonl \
    --catalog evaluation/config/seeded_mutations.json \
    --output evaluation/data/seeded_set.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
from typing import Any

from dotenv import load_dotenv


def read_jsonl(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def detect_lang(path: str) -> str:
    if path.endswith(".svelte"):
        return "svelte"
    if path.endswith(".vue"):
        return "vue"
    if path.endswith(".tsx"):
        return "tsx"
    if path.endswith(".ts"):
        return "ts"
    if path.endswith(".jsx"):
        return "jsx"
    if path.endswith(".js"):
        return "js"
    if path.endswith(".html"):
        return "html"
    if path.endswith(".css"):
        return "css"
    if path.endswith(".scss"):
        return "scss"
    if path.endswith(".rb") or path.endswith(".rake"):
        return "rb"
    if path.endswith(".erb"):
        return "erb"
    if path.endswith(".java"):
        return "java"
    if path.endswith(".kt") or path.endswith(".kts"):
        return "kt"
    if path.endswith(".xml"):
        return "xml"
    if path.endswith(".yml") or path.endswith(".yaml"):
        return "yaml"
    if path.endswith(".properties"):
        return "properties"
    return "unknown"


_TEST_PATH_PATTERNS = (
    "/__tests__/",
    "/__test__/",
    ".test.js",
    ".test.ts",
    ".test.jsx",
    ".test.tsx",
    ".spec.js",
    ".spec.ts",
    ".spec.jsx",
    ".spec.tsx",
)


def is_test_file(path: str) -> bool:
    return any(pat in path for pat in _TEST_PATH_PATTERNS)


def inject_patch(
    original_patch: str,
    line_snippet: str,
    context_lines: list[str] | None = None,
) -> tuple[str, int]:
    patch_lines = original_patch.splitlines()
    if not patch_lines:
        return original_patch, 1

    # Find a reasonable injection point after first hunk header.
    insert_idx = 1 if patch_lines[0].startswith("@@") else 0
    prefix = [f"+{cl}" for cl in (context_lines or [])]
    injected = (
        patch_lines[:insert_idx]
        + prefix
        + [f"+{line_snippet}"]
        + patch_lines[insert_idx:]
    )

    # Best-effort line extraction from hunk header.
    header = patch_lines[0] if patch_lines else ""
    m = re.search(r"\+(\d+)", header)
    base_line = int(m.group(1)) if m else 1
    # must_find points to the vulnerability line, after any context prefix lines
    injected_line = base_line + len(context_lines or [])
    return "\n".join(injected), injected_line


def choose_rule(
    rules: list[dict[str, Any]], lang: str, rnd: random.Random
) -> dict[str, Any] | None:
    candidates = [rule for rule in rules if lang in rule.get("languages", [])]
    if not candidates:
        return None
    return rnd.choice(candidates)


def get_snippet_for_lang(rule: dict[str, Any], lang: str) -> str:
    return rule.get("language_snippets", {}).get(lang, rule["line_snippet"])


def build_seeded_item(
    gold_item: dict[str, Any],
    rules: list[dict[str, Any]],
    rnd: random.Random,
) -> dict[str, Any] | None:
    file_changes = gold_item.get("file_changes", [])
    if not file_changes:
        return None

    # Prefer production files over test files so agents see realistic vulnerabilities
    prod_candidates = [
        fc
        for fc in file_changes
        if fc.get("patch") and not is_test_file(fc.get("path", ""))
    ]
    candidates = prod_candidates if prod_candidates else file_changes

    target = rnd.choice(candidates)
    path = target.get("path", "")
    patch = target.get("patch", "")
    lang = detect_lang(path)
    rule = choose_rule(rules, lang, rnd)
    if not rule:
        return None

    snippet = get_snippet_for_lang(rule, lang)
    context_lines = rule.get("context_lines")
    seeded_patch, seeded_line = inject_patch(patch, snippet, context_lines)

    seeded_changes = []
    for fc in file_changes:
        if fc.get("path") == path and fc.get("patch") == target.get("patch"):
            seeded_changes.append({"path": path, "patch": seeded_patch})
        else:
            seeded_changes.append(fc)

    return {
        "id": f"seeded::{gold_item['id']}::{rule['rule_id']}",
        "base_source": gold_item["id"],
        "repository": gold_item["repository"],
        "pr_number": gold_item["pr_number"],
        "file_changes": seeded_changes,
        "must_find": [
            {
                "rule_id": rule["rule_id"],
                "category": rule["category"],
                "severity": rule["severity"],
                "path": path,
                "line": seeded_line,
                "summary": rule["summary"],
            }
        ],
    }


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Build Seeded set from Gold set")
    parser.add_argument("--gold", required=True, help="Path to Gold JSONL")
    parser.add_argument(
        "--catalog", required=True, help="Path to mutation catalog JSON"
    )
    parser.add_argument("--output", required=True, help="Path to output Seeded JSONL")
    parser.add_argument(
        "--multiplier", type=int, default=1, help="Seeded items per Gold item"
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    rnd = random.Random(args.seed)
    gold_items = read_jsonl(args.gold)
    with open(args.catalog, encoding="utf-8") as f:
        catalog = json.load(f)
    rules: list[dict[str, Any]] = catalog.get("rules", [])

    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    count = 0
    with open(args.output, "w", encoding="utf-8") as out:
        for item in gold_items:
            for _ in range(max(args.multiplier, 1)):
                seeded = build_seeded_item(item, rules, rnd)
                if not seeded:
                    continue
                out.write(json.dumps(seeded, ensure_ascii=False) + "\n")
                count += 1

    print(f"Done. Seeded items: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
