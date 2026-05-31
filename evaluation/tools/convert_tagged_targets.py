#!/usr/bin/env python3
"""Convert tagged PR candidates into execution target list.

Input format:
[
  {
    "repository": "owner/repo",
    "pr_number": 123,
    "stack": "rails|spring-boot|react|vue|svelte",
    "priority_themes": ["security", "tenant"],
    "risk_priority": "high|medium|low"
  }
]

Output format:
[
  {"repository": "owner/repo", "pr_number": 123}
]
"""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from dataclasses import dataclass
from typing import Any


RISK_SCORE = {"low": 1, "medium": 2, "high": 3}


@dataclass(frozen=True)
class TaggedTarget:
    repository: str
    pr_number: int
    stack: str
    risk_priority: str
    priority_themes: tuple[str, ...]


def load_tagged(path: str) -> list[TaggedTarget]:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    out: list[TaggedTarget] = []
    for row in raw:
        out.append(
            TaggedTarget(
                repository=row["repository"],
                pr_number=int(row["pr_number"]),
                stack=row.get("stack", "unknown"),
                risk_priority=row.get("risk_priority", "low"),
                priority_themes=tuple(row.get("priority_themes", [])),
            )
        )
    return out


def parse_csv_arg(raw: str | None) -> set[str]:
    if not raw:
        return set()
    return {v.strip() for v in raw.split(",") if v.strip()}


def filter_rows(
    rows: list[TaggedTarget],
    stacks: set[str],
    min_risk: str,
    themes_any: set[str],
) -> list[TaggedTarget]:
    min_score = RISK_SCORE[min_risk]
    out: list[TaggedTarget] = []
    for row in rows:
        if stacks and row.stack not in stacks:
            continue
        if RISK_SCORE.get(row.risk_priority, 1) < min_score:
            continue
        if themes_any and not any(theme in themes_any for theme in row.priority_themes):
            continue
        out.append(row)
    return out


def dedupe_rows(rows: list[TaggedTarget]) -> list[TaggedTarget]:
    seen: set[tuple[str, int]] = set()
    out: list[TaggedTarget] = []
    for row in rows:
        key = (row.repository, row.pr_number)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def select_balanced(rows: list[TaggedTarget], limit: int) -> list[TaggedTarget]:
    by_stack: dict[str, list[TaggedTarget]] = defaultdict(list)
    for row in rows:
        by_stack[row.stack].append(row)

    # Prioritize higher risk first within each stack.
    for stack in by_stack:
        by_stack[stack].sort(
            key=lambda r: RISK_SCORE.get(r.risk_priority, 1), reverse=True
        )

    stacks = sorted(by_stack.keys())
    selected: list[TaggedTarget] = []
    idx = 0
    while len(selected) < limit and stacks:
        stack = stacks[idx % len(stacks)]
        bucket = by_stack[stack]
        if bucket:
            selected.append(bucket.pop(0))
        stacks = [s for s in stacks if by_stack[s]]
        idx += 1
    return selected


def to_output(rows: list[TaggedTarget]) -> list[dict[str, Any]]:
    return [{"repository": row.repository, "pr_number": row.pr_number} for row in rows]


def summarize(rows: list[TaggedTarget]) -> dict[str, Any]:
    stack_count: dict[str, int] = defaultdict(int)
    risk_count: dict[str, int] = defaultdict(int)
    for row in rows:
        stack_count[row.stack] += 1
        risk_count[row.risk_priority] += 1
    return {
        "total": len(rows),
        "stack_distribution": dict(sorted(stack_count.items())),
        "risk_distribution": dict(sorted(risk_count.items())),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert tagged PR targets into execution target JSON"
    )
    parser.add_argument("--input", required=True, help="Tagged JSON input path")
    parser.add_argument("--output", required=True, help="Execution JSON output path")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of targets (0 means no limit)",
    )
    parser.add_argument("--stacks", default="", help="Comma-separated stack filter")
    parser.add_argument(
        "--min-risk",
        choices=["low", "medium", "high"],
        default="low",
        help="Minimum accepted risk priority",
    )
    parser.add_argument(
        "--themes-any",
        default="",
        help="Comma-separated themes; include row if any theme matches",
    )
    parser.add_argument(
        "--balanced", action="store_true", help="Pick targets in round-robin by stack"
    )
    parser.add_argument(
        "--shuffle", action="store_true", help="Shuffle before limiting"
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for shuffle")
    parser.add_argument(
        "--print-summary", action="store_true", help="Print selection summary"
    )
    args = parser.parse_args()

    rows = load_tagged(args.input)
    rows = dedupe_rows(rows)
    rows = filter_rows(
        rows=rows,
        stacks=parse_csv_arg(args.stacks),
        min_risk=args.min_risk,
        themes_any=parse_csv_arg(args.themes_any),
    )

    if args.shuffle:
        rnd = random.Random(args.seed)
        rnd.shuffle(rows)
    else:
        rows.sort(key=lambda r: RISK_SCORE.get(r.risk_priority, 1), reverse=True)

    if args.limit > 0:
        if args.balanced:
            rows = select_balanced(rows, args.limit)
        else:
            rows = rows[: args.limit]

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(to_output(rows), f, ensure_ascii=False, indent=2)
        f.write("\n")

    if args.print_summary:
        print(json.dumps(summarize(rows), ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
