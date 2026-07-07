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
import sys
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
    "/test_",
    "_test.py",
    "/tests/",
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


def get_snippet_for_lang(rule: dict[str, Any], lang: str) -> str:
    lang_snippets = rule.get("language_snippets", {})
    return lang_snippets.get(lang) or rule["line_snippet"]


def candidate_files(gold_item: dict[str, Any]) -> list[dict[str, Any]]:
    """Pick the file_changes eligible as a mutation target.

    Prefers production files (non-test, with a non-empty patch) over test
    files so agents see realistic vulnerabilities; falls back to all
    file_changes when no production file qualifies.
    """
    file_changes = gold_item.get("file_changes", [])
    prod_candidates = [
        fc
        for fc in file_changes
        if fc.get("patch") and not is_test_file(fc.get("path", ""))
    ]
    return prod_candidates if prod_candidates else file_changes


def enumerate_combo_pool(
    gold_item: dict[str, Any], rules: list[dict[str, Any]]
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Enumerate every distinct (file_change, rule) pair valid for this item.

    A pair is valid when the rule's `languages` list contains the file's
    detected language. Pool size is NOT files x rules -- it is the sum,
    over candidate files, of the count of rules whose `languages` include
    that file's detected language, since each file may have a different
    detected language and thus a different set of matching rules.
    """
    pool: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for fc in candidate_files(gold_item):
        lang = detect_lang(fc.get("path", ""))
        for rule in rules:
            if lang in rule.get("languages", []):
                pool.append((fc, rule))
    return pool


def render_seeded_item(
    gold_item: dict[str, Any],
    file_change: dict[str, Any],
    rule: dict[str, Any],
) -> dict[str, Any]:
    """Build one Seeded item from an already-chosen (file_change, rule) combo."""
    path = file_change.get("path", "")
    patch = file_change.get("patch") or ""
    lang = detect_lang(path)
    snippet = get_snippet_for_lang(rule, lang)
    context_lines = rule.get("context_lines")
    seeded_patch, seeded_line = inject_patch(patch, snippet, context_lines)

    file_changes = gold_item.get("file_changes", [])
    seeded_changes = [
        {"path": path, "patch": seeded_patch} if fc is file_change else fc
        for fc in file_changes
    ]

    return {
        "id": f"seeded::{gold_item['id']}::{rule['rule_id']}::{path}",
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


def build_seeded_items(
    gold_item: dict[str, Any],
    rules: list[dict[str, Any]],
    rnd: random.Random,
    multiplier: int,
) -> tuple[list[dict[str, Any]], str | None]:
    """Build up to `multiplier` distinct Seeded items for one Gold item.

    Samples (file, rule) combos WITHOUT replacement: enumerates the full
    valid combo pool, shuffles it deterministically with `rnd`, then takes
    the first min(multiplier, len(pool)) entries. Shuffle-then-slice is
    used instead of retry-on-duplicate because retrying is unbounded/
    wasteful once the pool is nearly exhausted.

    Returns ([], None) when the pool is empty (no candidate file's
    language matches any rule), matching prior silent-skip behavior.
    Returns a non-None warning when `multiplier` exceeds the pool size,
    in which case the requested count is clamped to the pool size.
    """
    pool = enumerate_combo_pool(gold_item, rules)
    if not pool:
        return [], None

    rnd.shuffle(pool)
    requested = max(multiplier, 1)
    take = min(requested, len(pool))

    warning = None
    if requested > len(pool):
        warning = (
            f"[SEEDED-WARN] gold_id={gold_item['id']!r}: requested "
            f"multiplier={requested} exceeds available (file, rule) "
            f"combinations={len(pool)}; clamping to {take} seeded item(s)."
        )

    items = [render_seeded_item(gold_item, fc, rule) for fc, rule in pool[:take]]
    return items, warning


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
            items, warning = build_seeded_items(item, rules, rnd, args.multiplier)
            if warning:
                print(warning, file=sys.stderr)
            for seeded in items:
                out.write(json.dumps(seeded, ensure_ascii=False) + "\n")
                count += 1

    print(f"Done. Seeded items: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
