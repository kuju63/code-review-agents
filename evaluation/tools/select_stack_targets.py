#!/usr/bin/env python3
"""Select execution targets from per-stack Gold-set target files."""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from eval_logging import setup_logging

logger = logging.getLogger(__name__)

SEVERITY_SCORE = {"low": 1, "medium": 2, "high": 3, "critical": 4}
PRIORITIES = {"low", "medium", "high"}
IMPACTS = {"security", "correctness", "performance", "maintainability"}
REPO_TYPES = {"ui-library", "application"}
KNOWN_STACKS = {"react", "vue", "angular", "svelte"}
DOMAIN_MIN_RATIOS: dict[str, Any] = {
    "repo_type_balance_tolerance_pp": 15,
    "stack_within_ui-library": {"react": 0.50, "vue": 0.30},
    "stack_within_application": {
        "react": 0.40,
        "vue": 0.30,
        "svelte": 0.15,
        "angular": 0.15,
    },
    "impact": {
        "security": 0.40,
        "correctness": 0.30,
        "performance_maintainability": 0.30,
    },
}


@dataclass(frozen=True)
class StackTarget:
    """A classified pull-request target from a per-stack input file."""

    repository: str
    pr_number: int
    stack: str
    repo_type: str
    severity: str
    impact: str
    priority: str


def _validate_choice(field: str, value: str, choices: set[str]) -> str:
    """Validate and return an enumerated target field.

    Returns:
        The validated value.

    Raises:
        ValueError: If the value is not one of the allowed choices.
    """
    if value not in choices:
        allowed = ", ".join(sorted(choices))
        raise ValueError(f"invalid {field}={value!r}; expected one of: {allowed}")
    return value


def load_targets(paths: list[str]) -> list[StackTarget]:
    """Load and validate targets from multiple JSON array files.

    Returns:
        Targets in input-file order.

    Raises:
        ValueError: If an input is not an array or contains an invalid field.
    """
    targets: list[StackTarget] = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, list):
            raise ValueError(f"input is not a JSON array: {path}")
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                raise ValueError(f"invalid target at {path}[{index}]")
            try:
                raw_repository = item["repository"]
                raw_pr_number = item["pr_number"]
                raw_stack = item["stack"]
                raw_repo_type = item["repo_type"]
                raw_severity = item["severity"]
                raw_impact = item["impact"]
                raw_priority = item["priority"]
            except KeyError as exc:
                raise ValueError(f"missing {exc.args[0]} at {path}[{index}]") from exc

            location = f"{path}[{index}]"
            if isinstance(raw_pr_number, bool) or not isinstance(raw_pr_number, int):
                raise ValueError(
                    f"invalid target at {location}: pr_number={raw_pr_number!r}"
                )
            pr_number = raw_pr_number
            try:
                repository = str(raw_repository)
                stack = _validate_choice("stack", str(raw_stack), KNOWN_STACKS)
                repo_type = _validate_choice(
                    "repo_type", str(raw_repo_type), REPO_TYPES
                )
                severity = _validate_choice(
                    "severity", str(raw_severity), set(SEVERITY_SCORE)
                )
                impact = _validate_choice("impact", str(raw_impact), IMPACTS)
                priority = _validate_choice("priority", str(raw_priority), PRIORITIES)
            except ValueError as exc:
                raise ValueError(f"invalid target at {location}: {exc}") from exc
            if not repository or pr_number < 1:
                raise ValueError(f"invalid target identity at {location}")
            targets.append(
                StackTarget(
                    repository=repository,
                    pr_number=pr_number,
                    stack=stack,
                    repo_type=repo_type,
                    severity=severity,
                    impact=impact,
                    priority=priority,
                )
            )
    return targets


def parse_csv_arg(raw: str | None) -> set[str]:
    """Parse a comma-separated CLI argument.

    Returns:
        Trimmed non-empty values.
    """
    if not raw:
        return set()
    return {value.strip() for value in raw.split(",") if value.strip()}


def filter_rows(
    rows: list[StackTarget],
    stacks: set[str],
    min_severity: str,
    impacts: set[str],
    priorities: set[str],
) -> list[StackTarget]:
    """Filter targets by stack and the three classification axes.

    Returns:
        Targets satisfying every configured filter.
    """
    minimum = SEVERITY_SCORE[min_severity]
    return [
        row
        for row in rows
        if (not stacks or row.stack in stacks)
        and SEVERITY_SCORE[row.severity] >= minimum
        and (not impacts or row.impact in impacts)
        and (not priorities or row.priority in priorities)
    ]


def dedupe_rows(rows: list[StackTarget]) -> list[StackTarget]:
    """Remove duplicate repository and pull-request pairs.

    Returns:
        De-duplicated targets preserving the first occurrence.
    """
    seen: set[tuple[str, int]] = set()
    result: list[StackTarget] = []
    for row in rows:
        key = (row.repository, row.pr_number)
        if key in seen:
            continue
        seen.add(key)
        result.append(row)
    return result


def _rank(row: StackTarget) -> tuple[int, int]:
    """Return the deterministic severity and priority ordering key."""
    priority_score = {"low": 1, "medium": 2, "high": 3}
    return SEVERITY_SCORE[row.severity], priority_score[row.priority]


def select_balanced(
    rows: list[StackTarget], limit: int, *, sort_by_rank: bool = True
) -> list[StackTarget]:
    """Select targets round-robin across stacks.

    Returns:
        At most ``limit`` targets balanced across available stacks.
    """
    by_stack: dict[str, list[StackTarget]] = defaultdict(list)
    for row in rows:
        by_stack[row.stack].append(row)
    if sort_by_rank:
        for bucket in by_stack.values():
            bucket.sort(key=_rank, reverse=True)

    stacks = sorted(by_stack)
    selected: list[StackTarget] = []
    index = 0
    while len(selected) < limit and stacks:
        stack = stacks[index % len(stacks)]
        bucket = by_stack[stack]
        if bucket:
            selected.append(bucket.pop(0))
        stacks = [name for name in stacks if by_stack[name]]
        index += 1
    return selected


def allocate_quota(
    limit: int, repo_types: list[str], strata: dict[str, list[StackTarget]]
) -> dict[str, int]:
    """Split a limit evenly and redistribute unavailable quota.

    Returns:
        Allocated target count for each repository type.
    """
    if not repo_types:
        return {}
    ideal = {repo_type: limit // len(repo_types) for repo_type in repo_types}
    ideal[repo_types[0]] += limit - sum(ideal.values())

    allocated: dict[str, int] = {}
    shortfall = 0
    for repo_type in repo_types:
        available = len(strata.get(repo_type, []))
        allocated[repo_type] = min(ideal[repo_type], available)
        shortfall += max(0, ideal[repo_type] - available)

    while shortfall:
        progressed = False
        for repo_type in repo_types:
            spare = len(strata.get(repo_type, [])) - allocated[repo_type]
            if spare <= 0:
                continue
            take = min(spare, shortfall)
            allocated[repo_type] += take
            shortfall -= take
            progressed = True
            if not shortfall:
                break
        if not progressed:
            break
    return allocated


def select_stratified(
    rows: list[StackTarget], limit: int, seed: int, balanced: bool
) -> list[StackTarget]:
    """Randomly select targets stratified evenly by repository type.

    Returns:
        At most ``limit`` deterministic targets for the supplied seed.
    """
    randomizer = random.Random(seed)
    strata: dict[str, list[StackTarget]] = defaultdict(list)
    for row in rows:
        strata[row.repo_type].append(row)
    repo_types = sorted(strata)
    for bucket in strata.values():
        randomizer.shuffle(bucket)

    quota = allocate_quota(limit, repo_types, strata)
    selected: list[StackTarget] = []
    for repo_type in repo_types:
        bucket = strata[repo_type]
        count = quota[repo_type]
        if balanced:
            selected.extend(select_balanced(bucket, count, sort_by_rank=False))
        else:
            selected.extend(bucket[:count])

    if len(selected) < limit:
        selected_keys = {(row.repository, row.pr_number) for row in selected}
        remaining = [
            row for row in rows if (row.repository, row.pr_number) not in selected_keys
        ]
        randomizer.shuffle(remaining)
        selected.extend(remaining[: limit - len(selected)])
    return selected[:limit]


def check_coverage_thresholds(
    rows: list[StackTarget], summary: dict[str, Any]
) -> list[str]:
    """Compare selected targets with the evaluation coverage policy.

    Returns:
        Advisory coverage warning messages.
    """
    total = len(rows)
    if not total:
        return []
    warnings: list[str] = []
    tolerance = DOMAIN_MIN_RATIOS["repo_type_balance_tolerance_pp"]
    for repo_type in sorted(REPO_TYPES):
        ratio = summary["repo_type_distribution"].get(repo_type, 0) / total
        if abs(ratio - 0.5) * 100 > tolerance:
            warnings.append(
                f"[COVERAGE-WARN] repo_type={repo_type} ratio={ratio:.1%} "
                "deviates from 50% target beyond tolerance "
                "(EVALUATION_PLAN.md §2.0)"
            )

    stack_policy = {
        "ui-library": DOMAIN_MIN_RATIOS["stack_within_ui-library"],
        "application": DOMAIN_MIN_RATIOS["stack_within_application"],
    }
    for repo_type, minimums in stack_policy.items():
        bucket = summary["stack_distribution_by_repo_type"].get(repo_type, {})
        bucket_total = sum(bucket.values())
        if not bucket_total:
            continue
        for stack, minimum in minimums.items():
            actual = bucket.get(stack, 0) / bucket_total
            if actual < minimum:
                warnings.append(
                    f"[COVERAGE-WARN] {repo_type}/{stack} ratio={actual:.1%} "
                    f"< min {minimum:.0%} (EVALUATION_PLAN.md §2.0)"
                )

    impact_counts = summary["impact_distribution"]
    impact_ratios = {
        "security": impact_counts.get("security", 0) / total,
        "correctness": impact_counts.get("correctness", 0) / total,
        "performance_maintainability": (
            impact_counts.get("performance", 0)
            + impact_counts.get("maintainability", 0)
        )
        / total,
    }
    for impact, minimum in DOMAIN_MIN_RATIOS["impact"].items():
        actual = impact_ratios[impact]
        if actual < minimum:
            warnings.append(
                f"[COVERAGE-WARN] impact={impact} ratio={actual:.1%} "
                f"< min {minimum:.0%}"
            )
    return warnings


def summarize(rows: list[StackTarget]) -> dict[str, Any]:
    """Build distributions and advisory coverage warnings.

    Returns:
        JSON-serializable selection summary.
    """
    stack_count: dict[str, int] = defaultdict(int)
    severity_count: dict[str, int] = defaultdict(int)
    impact_count: dict[str, int] = defaultdict(int)
    priority_count: dict[str, int] = defaultdict(int)
    repo_type_count: dict[str, int] = defaultdict(int)
    stack_by_repo_type: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    for row in rows:
        stack_count[row.stack] += 1
        severity_count[row.severity] += 1
        impact_count[row.impact] += 1
        priority_count[row.priority] += 1
        repo_type_count[row.repo_type] += 1
        stack_by_repo_type[row.repo_type][row.stack] += 1

    summary: dict[str, Any] = {
        "total": len(rows),
        "stack_distribution": dict(sorted(stack_count.items())),
        "severity_distribution": dict(sorted(severity_count.items())),
        "impact_distribution": dict(sorted(impact_count.items())),
        "priority_distribution": dict(sorted(priority_count.items())),
        "repo_type_distribution": dict(sorted(repo_type_count.items())),
        "stack_distribution_by_repo_type": {
            repo_type: dict(sorted(counts.items()))
            for repo_type, counts in sorted(stack_by_repo_type.items())
        },
    }
    summary["coverage_warnings"] = check_coverage_thresholds(rows, summary)
    return summary


def _to_output(rows: list[StackTarget]) -> list[dict[str, Any]]:
    """Convert classified targets to the Gold builder input schema.

    Returns:
        Execution targets retaining ``stack`` and finding-axis proxy
        labels (Issue #181: ``stack`` must survive through to the Gold
        and Seeded sets for stack-based reviewer routing).
    """
    return [
        {
            "repository": row.repository,
            "pr_number": row.pr_number,
            "stack": row.stack,
            "severity": row.severity,
            "impact": row.impact,
            "priority": row.priority,
        }
        for row in rows
    ]


def main() -> int:
    """Run per-stack target selection.

    Returns:
        Process exit status.
    """
    setup_logging()
    parser = argparse.ArgumentParser(
        description="Select execution targets from per-stack Gold-set inputs"
    )
    parser.add_argument("--inputs", nargs="+", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--stacks", default="")
    parser.add_argument(
        "--min-severity",
        choices=["low", "medium", "high", "critical"],
        default="low",
    )
    parser.add_argument("--impact", default="")
    parser.add_argument("--priority", default="")
    parser.add_argument("--balanced", action="store_true")
    parser.add_argument("--shuffle", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--stratify-repo-type", action="store_true")
    parser.add_argument("--print-summary", action="store_true")
    args = parser.parse_args()

    if args.stratify_repo_type and not args.shuffle:
        parser.error("--stratify-repo-type requires --shuffle")
    if args.stratify_repo_type and args.limit <= 0:
        parser.error("--stratify-repo-type requires --limit > 0")

    impacts = parse_csv_arg(args.impact)
    priorities = parse_csv_arg(args.priority)
    invalid_impacts = impacts - IMPACTS
    invalid_priorities = priorities - PRIORITIES
    if invalid_impacts:
        parser.error(f"invalid --impact: {', '.join(sorted(invalid_impacts))}")
    if invalid_priorities:
        parser.error(f"invalid --priority: {', '.join(sorted(invalid_priorities))}")

    rows = dedupe_rows(load_targets(args.inputs))
    rows = filter_rows(
        rows,
        stacks=parse_csv_arg(args.stacks),
        min_severity=args.min_severity,
        impacts=impacts,
        priorities=priorities,
    )
    if args.stratify_repo_type:
        rows = select_stratified(rows, args.limit, args.seed, args.balanced)
    else:
        if args.shuffle:
            random.Random(args.seed).shuffle(rows)
        else:
            rows.sort(key=_rank, reverse=True)
        if args.limit > 0:
            if args.balanced:
                rows = select_balanced(rows, args.limit, sort_by_rank=not args.shuffle)
            else:
                rows = rows[: args.limit]

    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(_to_output(rows), f, ensure_ascii=False, indent=2)
        f.write("\n")

    summary = summarize(rows)
    for warning in summary["coverage_warnings"]:
        logger.warning(warning)
    if args.print_summary:
        # stdout is the machine-readable contract for --print-summary
        # consumers -- keep this on print, not logging.
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
