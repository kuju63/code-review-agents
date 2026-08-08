#!/usr/bin/env python3
"""Build Seeded set from dedicated seed repositories (Issue #224).

Each Seed PR (in kuju63/{react,vue,angular,svelte}-seeded) embeds an
`INTENTIONAL` marker comment immediately before its injected defect. This
tool fetches each PR's diff via the GitHub REST API, locates those markers,
resolves their new-file line numbers, and joins them with hand-authored
must_find metadata (rule_id/category/severity/summary) from
evaluation/input/seeded_pr_targets_{stack}.json.

This replaces the retired mutation-injection approach (see
docs/eval-seeded-mutation-injection-design.md, now superseded) which
spliced synthetic defects into Gold PR diffs after the fact and could not
guarantee the injected code was reachable or contextually coherent.

Usage:
  python evaluation/tools/build_seeded_set.py \
    --targets evaluation/input/seeded_pr_targets_react.json \
              evaluation/input/seeded_pr_targets_vue.json \
              evaluation/input/seeded_pr_targets_angular.json \
              evaluation/input/seeded_pr_targets_svelte.json \
    --output evaluation/data/seeded_set.jsonl

  # Preview detected markers for one PR before writing its metadata:
  python evaluation/tools/build_seeded_set.py \
    --targets evaluation/input/seeded_pr_targets_vue.json \
    --pr kuju63/vue-seeded#13 --print-markers

Required env:
  GITHUB_TOKEN
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv

from code_review_agent.agents.pr_info_collector import is_target_file
from eval_logging import setup_logging
from github_api import fetch_pr_files

logger = logging.getLogger(__name__)

_STACKS = {"react", "vue", "angular", "svelte"}
_CATEGORIES = {"security", "performance", "correctness", "maintainability"}
_SEVERITIES = {"critical", "high", "medium", "low"}

_HUNK_HEADER_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")

# Matches an INTENTIONAL marker with or without svelte-seeded's SEED-nnn
# suffix. The suffix is matched but never extracted: svelte-seeded's
# security-defect PRs (#5-#9) and bad-practice PRs (#10-#21) each
# independently number from SEED-101, so SEED-101 appears in both #5 and
# #10 -- it carries no information and must never be used as a key. It
# exists purely as a human-readable location anchor within a single PR.
_INTENTIONAL_RE = re.compile(r"INTENTIONAL(?::\s*SEED-\d+)?")

# An added (`+`) line that is blank or contains only a single-line comment
# (//, /* ... */ opener, <!-- ... -->, #). Used to skip past a comment line
# immediately following an INTENTIONAL marker (e.g. an eslint-disable
# comment in svelte-seeded#6) to find the actual defect line.
_BLANK_OR_COMMENT_ONLY_RE = re.compile(r"^\+\s*($|//|/\*|<!--|#)")


def split_hunks(patch: str) -> list[list[str]]:
    """Split a unified diff patch string into per-hunk line groups.

    Each returned group starts with its `@@ ... @@` header line. Lines
    before the first header (if any) are discarded; there is no sensible
    hunk to attach them to.

    Returns:
        A list of hunks, each a list of that hunk's lines (header
        first). Empty if the patch has no hunk header at all.
    """
    hunks: list[list[str]] = []
    for line in patch.splitlines():
        if _HUNK_HEADER_RE.match(line):
            hunks.append([line])
        elif hunks:
            hunks[-1].append(line)
    return hunks


def parse_hunk_new_start(header_line: str) -> int:
    """Extract the new-file start line `c` from `@@ -a,b +c,d @@`.

    Falls back to 1 on a malformed header.

    Returns:
        The new-file start line ``c``, or ``1`` when ``header_line``
        doesn't match the hunk header pattern.
    """
    m = _HUNK_HEADER_RE.match(header_line)
    return int(m.group(1)) if m else 1


def count_new_lines_before(hunk_lines: Sequence[str], insertion_idx: int) -> int:
    """Count new-file lines consumed between the hunk header and insertion_idx.

    Context (` `) and added (`+`) lines advance the new file's line
    counter; removed (`-`) lines do not, since they are absent from the
    new file.

    Returns:
        The count of context/added lines between the hunk header and
        ``insertion_idx`` (inclusive).
    """
    return sum(
        1
        for line in hunk_lines[1 : insertion_idx + 1]
        if line.startswith(" ") or line.startswith("+")
    )


@dataclass(frozen=True)
class Defect:
    """One hand-authored must_find record for a Seed PR.

    Attributes:
        path: File path the defect lives in (must match a marker file).
        occurrence: 0-based index of this defect's marker among all
            INTENTIONAL markers detected on ``path``, in diff order.
            Disambiguates PRs with multiple markers in the same file
            (e.g. vue-seeded#13).
        rule_id: Snake_case defect-type identifier, following
            seeded_mutations.json's retired naming convention (e.g.
            ``vue_props_direct_mutation``). Never derived from SEED-nnn.
        category: One of security/performance/correctness/maintainability.
        severity: One of critical/high/medium/low.
        summary: Human-readable description of the defect.
        line_offset: Explicit line count from the marker to the defect,
            overriding the default scan-forward resolution. ``None`` for
            all but react-seeded#8, where the marker precedes a JSX
            `return (` rather than sitting directly above the defect.
    """

    path: str
    occurrence: int
    rule_id: str
    category: str
    severity: str
    summary: str
    line_offset: int | None = None


@dataclass(frozen=True)
class SeededPrTarget:
    """One Seed PR to fetch, with its expected defects."""

    repository: str
    stack: str
    pr_number: int
    defects: list[Defect]


@dataclass(frozen=True)
class MarkerHit:
    """One INTENTIONAL marker's location within a single file's patch.

    ``hunk`` is a tuple (not a list) so instances of this frozen dataclass
    stay safely hashable -- a frozen dataclass with a list field raises
    ``TypeError`` if ever hashed, since ``list`` itself isn't hashable.
    """

    hunk: tuple[str, ...]
    marker_idx: int  # index within hunk; 0 is the `@@ ... @@` header


def detect_intentional_markers(patch: str) -> list[MarkerHit]:
    """Detect all INTENTIONAL markers in one file's patch, in diff order.

    Language-agnostic by design: rather than branching on comment syntax
    (`//`, `<!--`, ...) per file extension, this matches the marker text
    itself against every added (`+`) line.

    Returns:
        MarkerHits in diff order (hunk order, then line order within a
        hunk). Empty if the patch has no marker.
    """
    hits: list[MarkerHit] = []
    for hunk in split_hunks(patch):
        hunk_tuple = tuple(hunk)
        for idx, line in enumerate(hunk):
            if idx == 0:
                continue  # header line
            if line.startswith("+") and _INTENTIONAL_RE.search(line):
                hits.append(MarkerHit(hunk=hunk_tuple, marker_idx=idx))
    return hits


def resolve_defect_line(hit: MarkerHit, line_offset: int | None = None) -> int:
    """Resolve the new-file line number of the defect a marker points at.

    With ``line_offset=None``, the defect is the first added line after
    the marker that isn't blank or comment-only. This alone reproduces
    both the universal +1 offset seen across 57 of 59 seed PRs and the
    svelte-seeded#6 +2 exception (an eslint-disable comment sits between
    the marker and the defect). An explicit ``line_offset`` (used only for
    react-seeded#8, where the marker sits above a JSX `return (` rather
    than directly above `dangerouslySetInnerHTML`) overrides the scan.

    Args:
        hit: The marker location.
        line_offset: Explicit offset from the marker line, or ``None`` to
            scan forward for the first substantive added line.

    Returns:
        The 1-based new-file line number of the defect.

    Raises:
        ValueError: No substantive added line follows the marker; an
            explicit ``line_offset`` is not positive; or a positive
            ``line_offset`` still lands outside the hunk or off an added
            line.
    """
    hunk = hit.hunk
    if line_offset is not None:
        if line_offset <= 0:
            # A defect is always scanned forward from its marker (every
            # real seed PR's explicit line_offset is positive). Rejecting
            # on defect_idx <= 0 alone isn't enough: line_offset=0 resolves
            # to the marker's own comment line, which itself starts with
            # `+` and would pass the added-line check below; a negative
            # offset can likewise land on a legitimate `+` line that
            # precedes the marker instead of failing, or wrap around to
            # the end of hunk via Python's negative indexing.
            raise ValueError(
                f"line_offset must be positive (a defect is always after "
                f"its marker), got {line_offset}"
            )
        defect_idx = hit.marker_idx + line_offset
    else:
        defect_idx = hit.marker_idx + 1
        while defect_idx < len(hunk) and (
            not hunk[defect_idx].startswith("+")
            or _BLANK_OR_COMMENT_ONLY_RE.match(hunk[defect_idx])
        ):
            defect_idx += 1
        if defect_idx >= len(hunk):
            raise ValueError("no defect line found after INTENTIONAL marker")

    if defect_idx >= len(hunk) or not hunk[defect_idx].startswith("+"):
        raise ValueError(
            f"line_offset resolves outside an added line: idx={defect_idx}"
        )
    return parse_hunk_new_start(hunk[0]) + count_new_lines_before(hunk, defect_idx) - 1


def load_targets(paths: list[str]) -> list[SeededPrTarget]:
    """Load and validate seeded_pr_targets_{stack}.json files.

    Args:
        paths: Paths to one or more seeded_pr_targets_{stack}.json files.

    Returns:
        Flattened list of SeededPrTarget across all input files.

    Raises:
        ValueError: A file is missing a required key, declares an unknown
            stack, an unknown category/severity, or a PR entry with no
            defects.
    """
    targets: list[SeededPrTarget] = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)

        for key in ("repository", "stack", "prs"):
            if key not in raw:
                raise ValueError(f"{path}: missing required key {key!r}")

        repository = raw["repository"]
        stack = raw["stack"]
        if stack not in _STACKS:
            allowed = ", ".join(sorted(_STACKS))
            raise ValueError(
                f"{path}: invalid stack {stack!r}; expected one of: {allowed}"
            )

        for pr_item in raw["prs"]:
            if "pr_number" not in pr_item:
                raise ValueError(
                    f"{path}: {repository}: PR entry missing required key 'pr_number'"
                )
            pr_number = int(pr_item["pr_number"])
            defects: list[Defect] = []
            for d in pr_item.get("defects", []):
                for key in ("path", "rule_id", "category", "severity", "summary"):
                    if key not in d:
                        raise ValueError(
                            f"{path}: {repository}#{pr_number}: defect missing "
                            f"required key {key!r}"
                        )
                category = d["category"]
                severity = d["severity"]
                if category not in _CATEGORIES:
                    allowed = ", ".join(sorted(_CATEGORIES))
                    raise ValueError(
                        f"{path}: {repository}#{pr_number}: invalid category "
                        f"{category!r}; expected one of: {allowed}"
                    )
                if severity not in _SEVERITIES:
                    allowed = ", ".join(sorted(_SEVERITIES))
                    raise ValueError(
                        f"{path}: {repository}#{pr_number}: invalid severity "
                        f"{severity!r}; expected one of: {allowed}"
                    )
                defects.append(
                    Defect(
                        path=d["path"],
                        occurrence=int(d.get("occurrence", 0)),
                        rule_id=d["rule_id"],
                        category=category,
                        severity=severity,
                        summary=d["summary"],
                        line_offset=d.get("line_offset"),
                    )
                )
            if not defects:
                raise ValueError(f"{path}: {repository}#{pr_number} has no defects")

            targets.append(
                SeededPrTarget(
                    repository=repository,
                    stack=stack,
                    pr_number=pr_number,
                    defects=defects,
                )
            )
    return targets


def build_seeded_item(target: SeededPrTarget, token: str) -> dict[str, Any]:
    """Fetch one Seed PR and build a Seeded item from its INTENTIONAL markers.

    Fails closed rather than silently degrading: the retired
    mutation-injection pipeline's characteristic failure mode was
    defects that quietly scored zero (see Issue #224's account of the
    2026-08-04 run, where 24 of 30 seeded items were silently excluded).
    This raises instead of skipping when the diff and the hand-authored
    metadata disagree.

    Args:
        target: The PR to fetch and its expected defects.
        token: GitHub personal access token.

    Returns:
        A Seeded item: ``{id, repository, pr_number, stack, file_changes,
        must_find}``, where ``must_find`` may hold multiple entries.

    Raises:
        ValueError: No marker found at all; the marker count doesn't match
            the metadata's defect count; two defects declare the same
            (path, occurrence); a metadata entry names a (path, occurrence)
            with no matching marker; a detected marker has no corresponding
            metadata entry; or a marker's file would be excluded from
            review by ``pr_info_collector.is_target_file`` (the file would
            never reach a reviewer, so its must_find would score zero for
            a reason invisible to the scorer).
    """
    owner, repo = target.repository.split("/", maxsplit=1)
    files = fetch_pr_files(owner, repo, target.pr_number, token)
    patch_by_path = {f["path"]: f["patch"] for f in files}

    markers_by_path: dict[str, list[MarkerHit]] = {}
    for path, patch in patch_by_path.items():
        hits = detect_intentional_markers(patch)
        if hits:
            markers_by_path[path] = hits

    total_markers = sum(len(hits) for hits in markers_by_path.values())
    if total_markers == 0:
        raise ValueError(
            f"no INTENTIONAL marker found in {target.repository}#{target.pr_number}"
        )
    if total_markers != len(target.defects):
        raise ValueError(
            f"{target.repository}#{target.pr_number}: found {total_markers} "
            f"marker(s) but metadata declares {len(target.defects)} defect(s)"
        )

    must_find: list[dict[str, Any]] = []
    consumed: set[tuple[str, int]] = set()
    for defect in target.defects:
        key = (defect.path, defect.occurrence)
        if key in consumed:
            raise ValueError(
                f"{target.repository}#{target.pr_number}: duplicate defect "
                f"declared for path={defect.path!r} occurrence={defect.occurrence}"
            )
        consumed.add(key)

        hits = markers_by_path.get(defect.path)
        if not hits or defect.occurrence >= len(hits):
            raise ValueError(
                f"{target.repository}#{target.pr_number}: no marker at "
                f"path={defect.path!r} occurrence={defect.occurrence}"
            )
        if not is_target_file(defect.path):
            raise ValueError(
                f"{target.repository}#{target.pr_number}: marker file "
                f"{defect.path!r} is excluded by pr_info_collector.is_target_file "
                "and would never reach a reviewer"
            )
        hit = hits[defect.occurrence]
        line = resolve_defect_line(hit, defect.line_offset)
        must_find.append(
            {
                "rule_id": defect.rule_id,
                "category": defect.category,
                "severity": defect.severity,
                "path": defect.path,
                "line": line,
                "summary": defect.summary,
            }
        )

    all_marker_keys = {
        (path, occurrence)
        for path, hits in markers_by_path.items()
        for occurrence in range(len(hits))
    }
    unconsumed = all_marker_keys - consumed
    if unconsumed:
        raise ValueError(
            f"{target.repository}#{target.pr_number}: marker(s) not covered "
            f"by metadata: {sorted(unconsumed)}"
        )

    return {
        "id": f"seeded::{target.repository}#{target.pr_number}",
        "repository": target.repository,
        "pr_number": target.pr_number,
        "stack": target.stack,
        "file_changes": files,
        "must_find": must_find,
    }


def _print_markers(target: SeededPrTarget, token: str) -> None:
    """Print detected markers for one PR, for writing metadata before it exists."""
    owner, repo = target.repository.split("/", maxsplit=1)
    files = fetch_pr_files(owner, repo, target.pr_number, token)
    print(f"{target.repository}#{target.pr_number}:")
    for f in files:
        hits = detect_intentional_markers(f["patch"])
        for occurrence, hit in enumerate(hits):
            try:
                line = resolve_defect_line(hit)
            except ValueError as e:
                print(f"  path={f['path']} occurrence={occurrence} ERROR: {e}")
                continue
            print(f"  path={f['path']} occurrence={occurrence} line={line}")


def _parse_pr_filter(value: str) -> tuple[str, int]:
    repository, _, pr_part = value.rpartition("#")
    return repository, int(pr_part)


def main() -> int:
    load_dotenv()
    setup_logging()

    parser = argparse.ArgumentParser(
        description="Build Seeded set from dedicated seed repositories (Issue #224)"
    )
    parser.add_argument(
        "--targets",
        nargs="+",
        required=True,
        help="Path(s) to seeded_pr_targets_{stack}.json",
    )
    parser.add_argument("--output", help="Path to output Seeded JSONL")
    parser.add_argument("--stacks", help="Comma-separated stack filter")
    parser.add_argument(
        "--pr", help='Process a single PR only, e.g. "kuju63/vue-seeded#13"'
    )
    parser.add_argument(
        "--print-markers",
        action="store_true",
        help="Print detected markers instead of building must_find",
    )
    parser.add_argument(
        "--sleep", type=float, default=0.2, help="Sleep between API calls"
    )
    args = parser.parse_args()

    token = os.getenv("GITHUB_TOKEN")
    if not token:
        logger.error("GITHUB_TOKEN is required")
        return 2

    targets = load_targets(args.targets)

    if args.stacks:
        wanted = set(args.stacks.split(","))
        targets = [t for t in targets if t.stack in wanted]

    if args.pr:
        repository, pr_number = _parse_pr_filter(args.pr)
        targets = [
            t
            for t in targets
            if t.repository == repository and t.pr_number == pr_number
        ]
        if not targets:
            logger.error("no target matches --pr %s", args.pr)
            return 2

    if args.print_markers:
        for target in targets:
            _print_markers(target, token)
            time.sleep(args.sleep)
        return 0

    if not args.output:
        logger.error("--output is required unless --print-markers is set")
        return 2

    # Build every item before writing anything: build_seeded_item fails
    # closed (raises) on the first bad PR, and writing incrementally would
    # otherwise leave a truncated, silently-partial output file on disk
    # from an interrupted run -- worse than no file at all.
    items = []
    for target in targets:
        items.append(build_seeded_item(target, token))
        time.sleep(args.sleep)

    # Write to a temp file in the same directory and publish it atomically
    # via os.replace(): if the write itself fails partway (disk full, I/O
    # error), the previously-existing args.output must be left untouched
    # rather than truncated by opening it directly in "w" mode.
    output_dir = os.path.dirname(args.output) or "."
    os.makedirs(output_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=output_dir, prefix=f".{os.path.basename(args.output)}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            for item in items:
                out.write(json.dumps(item, ensure_ascii=False) + "\n")
        os.replace(tmp_path, args.output)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise

    logger.info("Done. Seeded items: %d", len(items))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
