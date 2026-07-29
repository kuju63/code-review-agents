#!/usr/bin/env python3
"""Merge shard predictions.jsonl files produced by run_agent_evaluation.py.

Usage:
  python evaluation/tools/merge_predictions.py \
    --gold evaluation/data/gold_pr_set.jsonl \
    --seeded evaluation/data/seeded_set.jsonl \
    --output evaluation/data/agent_predictions.jsonl \
    shard0.jsonl shard1.jsonl shard2.jsonl shard3.jsonl

Each shard file must have a failed_ids sidecar next to it
(<shard>.failed_ids.json, written automatically by run_agent_evaluation.py).
An id present in neither the merged predictions nor any sidecar is
"unaccounted" -- most likely a shard invocation that was killed mid-run by
an external time limit before it could write anything -- and is fatal by
default. Pass --allow-missing to downgrade that to a warning when partial
results are acceptable. See docs/eval-sharded-execution-spec.md §2.4.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def read_jsonl(path: str) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _failed_ids_path(pred_path: str) -> Path:
    """Sidecar path recording ids that raised during evaluation.

    Naming convention shared with run_agent_evaluation.py and
    generate_evaluation_report.py: ``agent_predictions.jsonl`` ->
    ``agent_predictions.failed_ids.json``.

    Returns:
        The sidecar path derived from *pred_path*.
    """
    p = Path(pred_path)
    return p.with_name(p.stem + ".failed_ids.json")


def merge(
    *,
    gold: str,
    seeded: str,
    output: str,
    pred_paths: list[str],
    allow_missing: bool,
) -> int:
    """Merge *pred_paths* into *output*, validating id coverage.

    Returns:
        0 if every expected id was produced with no failures, 1 if some
        ids are missing but fully accounted for (known failures, or
        unaccounted ids explicitly allowed via *allow_missing*), or 2 for
        a fatal error (duplicate id, an id outside Gold/Seeded, or an
        unaccounted id without *allow_missing*) -- in which case *output*
        is not written.
    """
    expected_items = read_jsonl(gold) + read_jsonl(seeded)
    expected_ids = {item["id"] for item in expected_items}

    merged: dict[str, dict[str, Any]] = {}
    merged_source: dict[str, str] = {}
    duplicates: list[tuple[str, str, str]] = []
    for pred_path in pred_paths:
        # A shard killed mid-run (the exact failure mode this tool exists to
        # detect) may never have created its output file at all -- treat that
        # the same as an empty predictions file rather than crashing, so its
        # ids fall through to the unaccounted/known-failed check below
        # instead of an uncaught traceback.
        if not Path(pred_path).exists():
            print(
                f"[WARN] Predictions file not found: {pred_path} (shard likely "
                "never completed); its ids will be treated as unaccounted.",
                file=sys.stderr,
            )
            continue
        for row in read_jsonl(pred_path):
            rid = row["id"]
            if rid in merged:
                duplicates.append((rid, merged_source[rid], pred_path))
            else:
                merged[rid] = row
                merged_source[rid] = pred_path

    if duplicates:
        print("[FATAL] Duplicate id(s) found across shard files:", file=sys.stderr)
        for rid, first, dup in duplicates:
            print(f"  - {rid}: present in both {first} and {dup}", file=sys.stderr)
        return 2

    unexpected_ids = merged.keys() - expected_ids
    if unexpected_ids:
        print(
            "[FATAL] id(s) present in predictions but not in --gold/--seeded "
            "(likely a mismatched --gold/--seeded pairing for this shard set):",
            file=sys.stderr,
        )
        for rid in sorted(unexpected_ids):
            print(f"  - {rid}", file=sys.stderr)
        return 2

    known_failed: set[str] = set()
    for pred_path in pred_paths:
        sidecar = _failed_ids_path(pred_path)
        if sidecar.exists():
            known_failed |= set(json.loads(sidecar.read_text(encoding="utf-8")))
        else:
            print(
                f"[WARN] No failed_ids sidecar found for {pred_path}; any of its "
                "gaps will be treated as unaccounted.",
                file=sys.stderr,
            )

    missing = expected_ids - merged.keys()
    unaccounted = missing - known_failed
    if unaccounted and not allow_missing:
        print(
            "[FATAL] Unaccounted id(s): present in neither the merged predictions "
            "nor any shard's failed_ids sidecar. This usually means a shard was "
            "never run (--shard-count mismatch) or was killed mid-run. Pass "
            "--allow-missing to accept this as a partial result.",
            file=sys.stderr,
        )
        for rid in sorted(unaccounted):
            print(f"  - {rid}", file=sys.stderr)
        return 2

    Path(output).parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        for item in expected_items:
            rid = item["id"]
            if rid in merged:
                f.write(json.dumps(merged[rid], ensure_ascii=False) + "\n")
    _failed_ids_path(output).write_text(
        json.dumps(sorted(missing), ensure_ascii=False), encoding="utf-8"
    )

    print(
        f"Merged {len(merged)}/{len(expected_ids)} items "
        f"({len(known_failed & missing)} known failure(s), "
        f"{len(unaccounted)} unaccounted allowed via --allow-missing) "
        f"-> {output}"
    )
    if missing:
        print("Missing ids (recorded in the merged failed_ids sidecar):")
        for rid in sorted(missing):
            print(f"  - {rid}")

    return 1 if missing else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Merge shard predictions.jsonl files into one"
    )
    parser.add_argument("--gold", required=True, help="Gold JSONL path")
    parser.add_argument("--seeded", required=True, help="Seeded JSONL path")
    parser.add_argument("--output", required=True, help="Merged predictions JSONL path")
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="Downgrade unaccounted ids (present in neither predictions nor any "
        "failed_ids sidecar) from a fatal error to a warning. Off by default so "
        "a shard killed mid-run by an external time limit isn't silently "
        "swallowed.",
    )
    parser.add_argument("pred", nargs="+", help="Shard predictions.jsonl paths")
    args = parser.parse_args()

    return merge(
        gold=args.gold,
        seeded=args.seeded,
        output=args.output,
        pred_paths=args.pred,
        allow_missing=args.allow_missing,
    )


if __name__ == "__main__":
    raise SystemExit(main())
