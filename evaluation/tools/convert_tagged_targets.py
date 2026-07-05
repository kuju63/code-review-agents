#!/usr/bin/env python3
"""Convert tagged PR candidates into execution target list.

Input format:
[
  {
    "repository": "owner/repo",
    "pr_number": 123,
    "stack": "react|vue|svelte|angular",
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
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv

RISK_SCORE = {"low": 1, "medium": 2, "high": 3}

# Best-effort mapping from the free-text `priority_themes` tags found in
# pr_targets_b2b2c_tagged.json to the three EVALUATION_PLAN.md §2.0 buckets.
# Tags not listed here fall back to "other" (see categorize_theme()).
THEME_CATEGORY_MAP: dict[str, str] = {
    # security
    "security": "security",
    "auth": "security",
    "injection": "security",
    "disclosure": "security",
    "data_exposure": "security",
    "pii_exposure": "security",
    "idor": "security",
    "mass_assignment": "security",
    "path_traversal": "security",
    "ssrf": "security",
    "shell_injection": "security",
    "http_security": "security",
    "oidc": "security",
    "url_scheme": "security",
    "url_validation": "security",
    "url_parsing": "security",
    "permissions": "security",
    "process_isolation": "security",
    "ipc": "security",
    "filesystem": "security",
    "serialization": "security",
    # correctness / unintended side effect
    "correctness": "correctness_side_effect",
    "side_effect": "correctness_side_effect",
    "error_handling": "correctness_side_effect",
    "data_loss": "correctness_side_effect",
    "reactivity": "correctness_side_effect",
    "state": "correctness_side_effect",
    "sorting": "correctness_side_effect",
    "controlled_component": "correctness_side_effect",
    "validation": "correctness_side_effect",
    "di": "correctness_side_effect",
    "logging": "correctness_side_effect",
    "api_stability": "correctness_side_effect",
    "breaking_change": "correctness_side_effect",
    # performance / maintainability (low-confidence proxy tags: the tagged
    # pool currently has no theme that directly names performance or
    # maintainability; see docs/evaluation-pipeline-design.md).
    "build_tool": "performance_maintainability",
    "dependency": "performance_maintainability",
    "cicd": "performance_maintainability",
    "api": "performance_maintainability",
}

# EVALUATION_PLAN.md §2.0 minimum ratios. Checked for visibility only; a
# shortfall is reported as a warning and never blocks the pipeline (the
# tagged pool itself is too small to guarantee some of these, e.g. Angular
# and Svelte have only a handful of entries in total).
DOMAIN_MIN_RATIOS: dict[str, Any] = {
    "repo_type_balance_tolerance_pp": 15,
    "stack_within_ui-library": {"react": 0.50, "vue": 0.30},
    "stack_within_application": {
        "react": 0.40,
        "vue": 0.30,
        "svelte": 0.15,
        "angular": 0.15,
    },
    "theme_category": {
        "security": 0.40,
        "correctness_side_effect": 0.30,
        "performance_maintainability": 0.30,
    },
}


@dataclass(frozen=True)
class TaggedTarget:
    repository: str
    pr_number: int
    stack: str
    repo_type: str
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
                repo_type=row.get("repo_type", "unknown"),
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


def select_balanced(
    rows: list[TaggedTarget], limit: int, *, sort_by_risk: bool = True
) -> list[TaggedTarget]:
    by_stack: dict[str, list[TaggedTarget]] = defaultdict(list)
    for row in rows:
        by_stack[row.stack].append(row)

    if sort_by_risk:
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


def allocate_quota(
    limit: int, repo_types: list[str], strata: dict[str, list[TaggedTarget]]
) -> dict[str, int]:
    """Split ``limit`` evenly across ``repo_types``, clamped to each stratum's
    stock, redistributing any shortfall to strata that still have spare rows.
    """
    if not repo_types:
        return {}

    ideal = {rt: limit // len(repo_types) for rt in repo_types}
    ideal[repo_types[0]] += limit - sum(ideal.values())

    final: dict[str, int] = {}
    shortfall = 0
    for rt in repo_types:
        avail = len(strata.get(rt, []))
        final[rt] = min(ideal[rt], avail)
        shortfall += max(0, ideal[rt] - avail)

    while shortfall > 0:
        progressed = False
        for rt in repo_types:
            spare = len(strata.get(rt, [])) - final[rt]
            if spare > 0:
                take = min(spare, shortfall)
                final[rt] += take
                shortfall -= take
                progressed = True
            if shortfall == 0:
                break
        if not progressed:
            break
    return final


def select_stratified(
    rows: list[TaggedTarget], limit: int, seed: int, balanced: bool
) -> list[TaggedTarget]:
    """Randomly select ``limit`` rows, stratified 50/50 by repo_type.

    Falls back to a plain shuffle(+balanced) selection when no row carries
    repo_type information (older tagged-input format).
    """
    rnd = random.Random(seed)

    strata: dict[str, list[TaggedTarget]] = defaultdict(list)
    for row in rows:
        strata[row.repo_type].append(row)

    stratifiable = sorted(k for k in strata if k != "unknown")
    if not stratifiable:
        shuffled = list(rows)
        rnd.shuffle(shuffled)
        if balanced:
            return select_balanced(shuffled, limit, sort_by_risk=False)
        return shuffled[:limit]

    for rt in strata:
        rnd.shuffle(strata[rt])

    quota = allocate_quota(limit, stratifiable, strata)

    selected: list[TaggedTarget] = []
    for rt in stratifiable:
        bucket = strata[rt]
        q = quota.get(rt, 0)
        if balanced:
            selected.extend(select_balanced(bucket, q, sort_by_risk=False))
        else:
            selected.extend(bucket[:q])

    if len(selected) < limit:
        selected_keys = {(r.repository, r.pr_number) for r in selected}
        leftover = [r for r in rows if (r.repository, r.pr_number) not in selected_keys]
        rnd.shuffle(leftover)
        selected.extend(leftover[: limit - len(selected)])

    return selected[:limit]


def to_output(rows: list[TaggedTarget]) -> list[dict[str, Any]]:
    return [{"repository": row.repository, "pr_number": row.pr_number} for row in rows]


def categorize_theme(theme: str) -> str:
    return THEME_CATEGORY_MAP.get(theme, "other")


def summarize(rows: list[TaggedTarget]) -> dict[str, Any]:
    stack_count: dict[str, int] = defaultdict(int)
    risk_count: dict[str, int] = defaultdict(int)
    repo_type_count: dict[str, int] = defaultdict(int)
    stack_by_repo_type: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    theme_category_count: dict[str, int] = defaultdict(int)

    for row in rows:
        stack_count[row.stack] += 1
        risk_count[row.risk_priority] += 1
        repo_type_count[row.repo_type] += 1
        stack_by_repo_type[row.repo_type][row.stack] += 1
        for cat in {categorize_theme(t) for t in row.priority_themes}:
            theme_category_count[cat] += 1

    summary: dict[str, Any] = {
        "total": len(rows),
        "stack_distribution": dict(sorted(stack_count.items())),
        "risk_distribution": dict(sorted(risk_count.items())),
        "repo_type_distribution": dict(sorted(repo_type_count.items())),
        "stack_distribution_by_repo_type": {
            rt: dict(sorted(d.items())) for rt, d in sorted(stack_by_repo_type.items())
        },
        "theme_category_distribution": dict(sorted(theme_category_count.items())),
    }
    summary["coverage_warnings"] = check_coverage_thresholds(rows, summary)
    return summary


def check_coverage_thresholds(
    rows: list[TaggedTarget], summary: dict[str, Any]
) -> list[str]:
    """Compare the selected rows against EVALUATION_PLAN.md §2.0 minimum
    ratios. Returns human-readable warnings; never raises and never implies
    the caller should stop (advisory only, see docs/evaluation-pipeline-design.md).
    """
    warnings: list[str] = []
    total = summary["total"]
    if total == 0:
        return warnings

    tolerance = DOMAIN_MIN_RATIOS["repo_type_balance_tolerance_pp"]
    for rt in ("ui-library", "application"):
        ratio = summary["repo_type_distribution"].get(rt, 0) / total
        if abs(ratio - 0.5) * 100 > tolerance:
            warnings.append(
                f"[COVERAGE-WARN] repo_type={rt} ratio={ratio:.1%} deviates from 50% "
                f"target beyond tolerance (EVALUATION_PLAN.md §2.0)"
            )

    for rt, mins in (
        ("ui-library", DOMAIN_MIN_RATIOS["stack_within_ui-library"]),
        ("application", DOMAIN_MIN_RATIOS["stack_within_application"]),
    ):
        bucket = summary["stack_distribution_by_repo_type"].get(rt, {})
        bucket_total = sum(bucket.values())
        if bucket_total == 0:
            continue
        for stack, min_ratio in mins.items():
            actual = bucket.get(stack, 0) / bucket_total
            if actual < min_ratio:
                warnings.append(
                    f"[COVERAGE-WARN] {rt}/{stack} ratio={actual:.1%} < min {min_ratio:.0%} "
                    f"(likely due to limited tagged pool size; see EVALUATION_PLAN.md §2.0.3)"
                )

    for cat, min_ratio in DOMAIN_MIN_RATIOS["theme_category"].items():
        actual = summary["theme_category_distribution"].get(cat, 0) / total
        if actual < min_ratio:
            warnings.append(
                f"[COVERAGE-WARN] theme_category={cat} ratio={actual:.1%} < min {min_ratio:.0%}"
            )
    return warnings


def main() -> int:
    load_dotenv()

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
        "--stratify-repo-type",
        action="store_true",
        help="Stratify selection ~50/50 by repo_type (ui-library/application); requires --shuffle",
    )
    parser.add_argument(
        "--print-summary", action="store_true", help="Print selection summary"
    )
    args = parser.parse_args()

    if args.stratify_repo_type and not args.shuffle:
        parser.error("--stratify-repo-type requires --shuffle")
    if args.stratify_repo_type and args.limit <= 0:
        parser.error("--stratify-repo-type requires --limit > 0")

    rows = load_tagged(args.input)
    rows = dedupe_rows(rows)
    rows = filter_rows(
        rows=rows,
        stacks=parse_csv_arg(args.stacks),
        min_risk=args.min_risk,
        themes_any=parse_csv_arg(args.themes_any),
    )

    if args.stratify_repo_type:
        rows = select_stratified(rows, args.limit, args.seed, args.balanced)
    else:
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

    summary = summarize(rows)
    for warning in summary["coverage_warnings"]:
        print(warning, file=sys.stderr)

    if args.print_summary:
        print(json.dumps(summary, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
