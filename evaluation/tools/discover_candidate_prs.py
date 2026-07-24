#!/usr/bin/env python3
"""Discover per-stack Gold-set PR targets from UI library / application repos.

Selects merged PRs that satisfy the requirements in
docs/goldset-per-stack-spec.md:

1. Repository released within the last 6 months (release, or tag fallback).
2. Repository has >= 5,000 stars.
3. PR changes production code (not test/doc-only).
4. PR has at least one review comment (human OR AI bot -- CodeRabbit,
   Copilot Code Review, etc.); PRs with no review comment are excluded.
5. PR change size is <= 20 files and <= 1,000 lines.

severity / impact / priority are derived by an LLM assessor as three
independent axes (see make_llm_assessor). Output is written per stack to
`pr_targets_{stack}.json`; there is no intermediate candidate file and no
manual curation step.

Usage:
  python evaluation/tools/discover_candidate_prs.py \\
    --repos evaluation/input/repo_candidates.json \\
    --output-dir evaluation/input

Required env (loaded from .env):
  GITHUB_TOKEN
  CODE_REVIEW_MODEL_ID       (optional, default: gpt-4o)
  CODE_REVIEW_LLM_BASE_URL   (optional; OpenAI-compatible endpoint)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Literal, cast

import requests
from dotenv import load_dotenv
from pydantic import BaseModel
from strands import Agent
from strands.models.openai import OpenAIModel

logger = logging.getLogger(__name__)

DEFAULT_STACKS = ("react", "vue", "angular", "svelte")

MIN_STARS = 5000
RELEASE_WINDOW_DAYS = 180
MAX_CHANGED_FILES = 20
MAX_CHANGED_LINES = 1000

# ---------------------------------------------------------------------------
# Production-code detection
# ---------------------------------------------------------------------------

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
    ".test.vue",
    ".spec.vue",
    ".test.svelte",
    ".spec.svelte",
    "/test_",
    "_test.py",
    "/tests/",
    "/test/",
    "/e2e/",
    "/cypress/",
    "/__mocks__/",
)

_DOC_SUFFIXES = (".md", ".mdx", ".rst", ".txt")
_DOC_PATH_PATTERNS = ("/docs/", "/documentation/")


def is_test_file(path: str) -> bool:
    return any(pat in path for pat in _TEST_PATH_PATTERNS)


def is_doc_file(path: str) -> bool:
    lower = path.lower()
    if lower.endswith(_DOC_SUFFIXES):
        return True
    return any(pat in lower for pat in _DOC_PATH_PATTERNS)


def has_production_code_change(files: list[dict[str, Any]]) -> bool:
    """Check whether the PR touches production code.

    Returns:
        True if at least one changed file is neither a test nor a doc file.
    """
    for file_item in files:
        path = file_item.get("filename", "")
        if not path:
            continue
        if is_test_file(path) or is_doc_file(path):
            continue
        return True
    return False


# ---------------------------------------------------------------------------
# Review-comment presence (human or AI bot)
# ---------------------------------------------------------------------------


def collect_review_texts(
    inline: list[dict[str, Any]], reviews: list[dict[str, Any]]
) -> list[str]:
    """Aggregate non-blank inline comment and review bodies (any author).

    Returns:
        The list of non-blank review text bodies.
    """
    texts: list[str] = []
    for comment in inline:
        body = (comment.get("body") or "").strip()
        if body:
            texts.append(body)
    for review in reviews:
        body = (review.get("body") or "").strip()
        if body:
            texts.append(body)
    return texts


def has_review_comments(
    inline: list[dict[str, Any]], reviews: list[dict[str, Any]]
) -> bool:
    """Check whether the PR has at least one non-blank review comment.

    The comment author may be a human or an AI review bot -- the spec only
    requires that some review remark exists, not that a bot produced it.

    Returns:
        True if at least one non-blank review comment exists.
    """
    return bool(collect_review_texts(inline, reviews))


# ---------------------------------------------------------------------------
# Change-size filter
# ---------------------------------------------------------------------------


def within_change_limits(
    pr_detail: dict[str, Any],
    max_files: int = MAX_CHANGED_FILES,
    max_lines: int = MAX_CHANGED_LINES,
) -> bool:
    changed_files = pr_detail.get("changed_files", 0)
    additions = pr_detail.get("additions", 0)
    deletions = pr_detail.get("deletions", 0)
    if changed_files > max_files:
        return False
    if additions + deletions > max_lines:
        return False
    return True


# ---------------------------------------------------------------------------
# Recent-release check
# ---------------------------------------------------------------------------


def _parse_iso(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def has_recent_release(
    client: GitHubClient,
    repo: str,
    now: datetime,
    days: int = RELEASE_WINDOW_DAYS,
) -> bool:
    """Check whether the repo has a recent release.

    Returns:
        True if the repo has a release (or tag fallback) within ``days``.
    """
    cutoff = now - timedelta(days=days)

    releases = client.list_releases(repo)
    for release in releases:
        published = _parse_iso(release.get("published_at") or "")
        if published and published >= cutoff:
            return True

    # Fallback: repos that ship via git tags rather than GitHub Releases.
    for tag_date in client.list_tags_with_dates(repo):
        parsed = _parse_iso(tag_date)
        if parsed and parsed >= cutoff:
            return True

    return False


# ---------------------------------------------------------------------------
# LLM 3-axis assessment (severity / impact / priority)
# ---------------------------------------------------------------------------

Severity = Literal["critical", "high", "medium", "low"]
Impact = Literal["security", "correctness", "performance", "maintainability"]
Priority = Literal["high", "medium", "low"]


class ReviewAssessment(BaseModel):
    """Structured 3-axis assessment of a PR's review findings.

    The three axes are deliberately independent so they do not collapse
    into one another (the failure mode of keyword-derived scoring):

    - severity: how serious the defect itself is.
    - impact: which quality attribute it affects.
    - priority: how urgently it should be fixed.
    """

    severity: Severity
    impact: Impact
    priority: Priority
    rationale: str


ReviewAssessor = Callable[[str, list[str]], "ReviewAssessment | None"]

_ASSESSOR_SYSTEM_PROMPT = """\
You analyze the review findings on a pull request and classify them along \
THREE INDEPENDENT axes. Do not let one axis determine another; judge each \
on its own terms.

1. severity (how serious the underlying defect is):
   critical | high | medium | low
2. impact (which software quality attribute the finding primarily affects):
   security | correctness | performance | maintainability
3. priority (how urgently the team should act on it, considering severity, \
blast radius, and reachability together):
   high | medium | low

A low-severity finding can still be high-priority (e.g. trivial fix, \
user-facing), and a high-severity finding can be low-priority (e.g. \
unreachable code path). Provide a brief, non-empty rationale.
"""


def make_llm_assessor(model_id: str, llm_base_url: str | None = None) -> ReviewAssessor:
    """Build an LLM-backed 3-axis assessor.

    Mirrors the model-selection pattern in
    ``score_evaluation.py::make_llm_semantic_judge``: a custom
    ``llm_base_url`` pins a low temperature; the default endpoint is used
    as-is otherwise. Fails closed -- returns None on any error or missing
    structured output so the caller can skip that PR.

    Returns:
        A callable that assesses a PR and returns a ``ReviewAssessment`` or
        None when the assessment fails.
    """
    if llm_base_url:
        model = OpenAIModel(
            model_id=model_id,
            client_args={"base_url": llm_base_url},
            params={"temperature": 0.0},
        )
    else:
        model = OpenAIModel(model_id=model_id)

    agent = Agent(model=model, system_prompt=_ASSESSOR_SYSTEM_PROMPT, tools=[])

    def assess(pr_title: str, review_texts: list[str]) -> ReviewAssessment | None:
        joined = "\n\n".join(f"- {t}" for t in review_texts)
        prompt = f"PR title: {pr_title}\n\nReview findings:\n{joined}"
        try:
            result = agent(prompt, structured_output_model=ReviewAssessment)
        except Exception:
            logger.warning("LLM assessment call failed; skipping PR", exc_info=True)
            return None
        if result.structured_output is None:
            return None
        return cast(ReviewAssessment, result.structured_output)

    return assess


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class RepoCandidate:
    repository: str
    repo_type: str
    stack: str


# ---------------------------------------------------------------------------
# GitHub API helpers
# ---------------------------------------------------------------------------


class GitHubClient:
    BASE = "https://api.github.com"

    def __init__(self, token: str) -> None:
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
        )

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.BASE}{path}"
        for _attempt in range(3):
            resp = self._session.get(url, params=params, timeout=30)
            if resp.status_code in (403, 429) and (
                "rate limit" in resp.text.lower() or resp.status_code == 429
            ):
                reset = int(resp.headers.get("X-RateLimit-Reset", time.time() + 60))
                wait = max(reset - int(time.time()), 1) + 2
                print(f"  [rate limit] waiting {wait}s ...")
                time.sleep(wait)
                continue
            if resp.status_code in (401, 404):
                return None
            resp.raise_for_status()
            return resp.json()
        return None

    def get_repo(self, repo: str) -> dict[str, Any] | None:
        return self._get(f"/repos/{repo}")

    def list_releases(self, repo: str, per_page: int = 10) -> list[dict[str, Any]]:
        result = self._get(f"/repos/{repo}/releases", params={"per_page": per_page})
        return result or []

    def list_tags_with_dates(self, repo: str, per_page: int = 10) -> list[str]:
        """Return commit dates (ISO 8601) for the repo's most recent tags."""
        tags = self._get(f"/repos/{repo}/tags", params={"per_page": per_page}) or []
        dates: list[str] = []
        for tag in tags[:per_page]:
            sha = (tag.get("commit") or {}).get("sha")
            if not sha:
                continue
            commit = self._get(f"/repos/{repo}/commits/{sha}")
            if not commit:
                continue
            date = ((commit.get("commit") or {}).get("committer") or {}).get("date")
            if date:
                dates.append(date)
            time.sleep(0.1)
        return dates

    def get_pr(self, repo: str, pr_number: int) -> dict[str, Any] | None:
        return self._get(f"/repos/{repo}/pulls/{pr_number}")

    def list_merged_prs(
        self, repo: str, since: str, per_page: int = 50
    ) -> list[dict[str, Any]]:
        """Return merged PRs updated since `since` (ISO 8601 string)."""
        prs: list[dict[str, Any]] = []
        page = 1
        while True:
            batch = self._get(
                f"/repos/{repo}/pulls",
                params={
                    "state": "closed",
                    "sort": "updated",
                    "direction": "desc",
                    "per_page": per_page,
                    "page": page,
                },
            )
            if not batch:
                break
            added = 0
            for pr in batch:
                if not pr.get("merged_at"):
                    continue
                if pr["updated_at"] < since:
                    return prs
                prs.append(pr)
                added += 1
            if added == 0 or len(batch) < per_page:
                break
            page += 1
            time.sleep(0.3)
        return prs

    def list_pr_files(self, repo: str, pr_number: int) -> list[dict[str, Any]]:
        files = self._get(
            f"/repos/{repo}/pulls/{pr_number}/files", params={"per_page": 100}
        )
        return files or []

    def list_review_comments(self, repo: str, pr_number: int) -> list[dict[str, Any]]:
        comments = self._get(
            f"/repos/{repo}/pulls/{pr_number}/comments", params={"per_page": 100}
        )
        return comments or []

    def list_pr_reviews(self, repo: str, pr_number: int) -> list[dict[str, Any]]:
        reviews = self._get(
            f"/repos/{repo}/pulls/{pr_number}/reviews", params={"per_page": 100}
        )
        return reviews or []


# ---------------------------------------------------------------------------
# Repository validation
# ---------------------------------------------------------------------------


def validate_repo(
    client: GitHubClient,
    candidate: RepoCandidate,
    now: datetime,
) -> tuple[bool, str]:
    """Return (ok, reason). Checks star count and recent release activity."""
    repo_data = client.get_repo(candidate.repository)
    if repo_data is None:
        return False, "repository not found"
    if repo_data.get("archived"):
        return False, "repository archived"

    stars = repo_data.get("stargazers_count", 0)
    if stars < MIN_STARS:
        return False, f"stars={stars} < {MIN_STARS}"

    if not has_recent_release(client, candidate.repository, now, RELEASE_WINDOW_DAYS):
        return False, f"no release in last {RELEASE_WINDOW_DAYS} days"

    return True, f"stars={stars}, recent_release=yes"


# ---------------------------------------------------------------------------
# PR evaluation
# ---------------------------------------------------------------------------


def build_target(
    client: GitHubClient,
    candidate: RepoCandidate,
    pr: dict[str, Any],
    assessor: ReviewAssessor,
) -> dict[str, Any] | None:
    """Evaluate one PR against all filters; return a target dict or None.

    Returns:
        The built target dict, or None (skip) when the PR fails any filter
        or when the LLM assessment fails (fail-closed).
    """
    repo = candidate.repository
    pr_number = pr["number"]

    pr_detail = client.get_pr(repo, pr_number)
    if pr_detail is None:
        return None
    if not within_change_limits(pr_detail):
        return None

    files = client.list_pr_files(repo, pr_number)
    if not has_production_code_change(files):
        return None

    inline = client.list_review_comments(repo, pr_number)
    reviews = client.list_pr_reviews(repo, pr_number)
    if not has_review_comments(inline, reviews):
        return None

    review_texts = collect_review_texts(inline, reviews)
    assessment = assessor(pr.get("title", ""), review_texts)
    if assessment is None:
        return None

    return {
        "repository": repo,
        "pr_number": pr_number,
        "stack": candidate.stack,
        "repo_type": candidate.repo_type,
        "severity": assessment.severity,
        "impact": assessment.impact,
        "priority": assessment.priority,
    }


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def write_stack_outputs(
    targets: list[dict[str, Any]],
    output_dir: str,
    stacks: tuple[str, ...] | list[str] = DEFAULT_STACKS,
) -> None:
    """Write targets grouped by stack to pr_targets_{stack}.json.

    Every stack in `stacks` gets a file, even when it has no targets (an
    empty JSON array), so downstream consumers see a stable set of files.
    Any stack present in `targets` but not in `stacks` also gets a file.
    """
    os.makedirs(output_dir, exist_ok=True)
    grouped: dict[str, list[dict[str, Any]]] = {stack: [] for stack in stacks}
    for target in targets:
        grouped.setdefault(target["stack"], []).append(target)

    for stack, rows in grouped.items():
        path = os.path.join(output_dir, f"pr_targets_{stack}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
            f.write("\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Discover per-stack Gold-set PR targets"
    )
    parser.add_argument(
        "--repos",
        default="evaluation/input/repo_candidates.json",
        help="Path to repo_candidates.json",
    )
    parser.add_argument(
        "--output-dir",
        default="evaluation/input",
        help="Directory to write pr_targets_{stack}.json into",
    )
    parser.add_argument(
        "--since",
        default=None,
        help="Search PRs merged/updated after this date (ISO 8601). "
        "Default: 6 months ago.",
    )
    parser.add_argument(
        "--max-prs-per-repo",
        type=int,
        default=60,
        help="Max PRs to fetch per repo before evaluating",
    )
    parser.add_argument(
        "--max-targets-per-repo",
        type=int,
        default=10,
        help="Max accepted targets to keep per repo",
    )
    parser.add_argument("--model-id", default=None, help="LLM model id for assessment")
    parser.add_argument(
        "--llm-base-url", default=None, help="OpenAI-compatible base URL"
    )
    parser.add_argument(
        "--skip-repos",
        default="",
        help="Comma-separated repos to skip",
    )
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN not set")
        return 1

    model_id = args.model_id or os.environ.get("CODE_REVIEW_MODEL_ID", "gpt-4o")
    llm_base_url = args.llm_base_url or os.environ.get("CODE_REVIEW_LLM_BASE_URL")
    assessor = make_llm_assessor(model_id, llm_base_url)

    client = GitHubClient(token)
    now = datetime.now(timezone.utc)
    since = args.since or (now - timedelta(days=RELEASE_WINDOW_DAYS)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    skip_repos = {r.strip() for r in args.skip_repos.split(",") if r.strip()}

    with open(args.repos, encoding="utf-8") as f:
        raw_repos = json.load(f)
    candidates = [RepoCandidate(**r) for r in raw_repos]

    all_targets: list[dict[str, Any]] = []
    for candidate in candidates:
        if candidate.repository in skip_repos:
            print(f"\n[{candidate.repository}] SKIP (requested)")
            continue

        print(f"\n[{candidate.repository}] validating ...")
        try:
            ok, reason = validate_repo(client, candidate, now)
        except Exception as e:  # noqa: BLE001
            print(f"  SKIP: validation error: {e}")
            continue
        if not ok:
            print(f"  SKIP: {reason}")
            continue
        print(f"  OK: {reason}")

        try:
            prs = client.list_merged_prs(candidate.repository, since=since, per_page=50)
        except Exception as e:  # noqa: BLE001
            print(f"  SKIP: failed to list PRs: {e}")
            continue
        print(f"  found {len(prs)} merged PRs")

        repo_targets: list[dict[str, Any]] = []
        for pr in prs[: args.max_prs_per_repo]:
            time.sleep(0.4)
            try:
                target = build_target(client, candidate, pr, assessor)
            except Exception as e:  # noqa: BLE001
                print(f"  WARN: PR #{pr['number']} failed: {type(e).__name__}")
                time.sleep(1)
                continue
            if target is not None:
                repo_targets.append(target)
            if len(repo_targets) >= args.max_targets_per_repo:
                break

        print(f"  accepted targets: {len(repo_targets)}")
        all_targets.extend(repo_targets)

        write_stack_outputs(all_targets, args.output_dir)
        print(f"  → wrote per-stack outputs to {args.output_dir}")
        time.sleep(1)

    write_stack_outputs(all_targets, args.output_dir)

    by_stack: dict[str, int] = {}
    for target in all_targets:
        by_stack[target["stack"]] = by_stack.get(target["stack"], 0) + 1
    print(f"\nTotal targets: {len(all_targets)}")
    for stack in sorted(by_stack):
        print(f"  {stack}: {by_stack[stack]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
