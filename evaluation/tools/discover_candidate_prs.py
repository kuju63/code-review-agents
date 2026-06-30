#!/usr/bin/env python3
"""Discover PR candidates from UI library / application repositories.

Searches merged PRs that have human review comments focusing on security
or unintended side effects — not design discussions.

Outputs a ranked JSON list for manual curation into pr_targets_b2b2c_tagged.json.

Usage:
  python evaluation/tools/discover_candidate_prs.py \\
    --repos evaluation/input/repo_candidates.json \\
    --output evaluation/input/pr_candidates_raw.json \\
    --min-score 0.3
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Scoring keywords
# ---------------------------------------------------------------------------

SECURITY_KEYWORDS = [
    "security",
    "xss",
    "inject",
    "auth",
    "vulnerab",
    "exploit",
    "sensitiv",
    "exposure",
    "bypass",
    "privilege",
    "idor",
    "csrf",
    "sanitiz",
    "disclosure",
    "attack",
    "malicious",
    "untrusted",
    "escape",
    "encode",
]

SIDEEFFECT_KEYWORDS = [
    "regression",
    "breaking",
    "unintended",
    "unexpected",
    "side effect",
    "race condition",
    "memory leak",
    "n+1",
    "performance impact",
    "infinite loop",
    "stale",
    "out of sync",
    "deadlock",
    "overflow",
    "edge case",
    "missed",
    "overlooked",
]

DESIGN_KEYWORDS = [
    "prefer",
    "consider",
    "naming",
    "refactor",
    "architecture",
    "design pattern",
    "style",
    "approach",
    "opinion",
    "nitpick",
    "nit:",
    "suggestion",
    "alternatively",
]

BOT_LOGINS = {
    "github-actions[bot]",
    "dependabot[bot]",
    "renovate[bot]",
    "codecov[bot]",
    "sonarcloud[bot]",
    "netlify[bot]",
    "vercel[bot]",
    "stale[bot]",
    "changeset-bot[bot]",
    "semantic-release-bot",
    "imgbot[bot]",
    "allcontributors[bot]",
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class RepoCandidate:
    repository: str
    repo_type: str
    stack: str


@dataclass
class ScoredPR:
    repository: str
    repo_type: str
    stack: str
    pr_number: int
    title: str
    merged_at: str
    security_score: float
    sideeffect_score: float
    design_penalty: float
    total_score: float
    human_comment_count: int
    sample_comments: list[str] = field(default_factory=list)


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
        for attempt in range(3):
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

    def list_commits(
        self, repo: str, since: str, per_page: int = 30
    ) -> list[dict[str, Any]]:
        result = self._get(
            f"/repos/{repo}/commits",
            params={"since": since, "per_page": per_page},
        )
        return result or []

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

    def list_review_comments(self, repo: str, pr_number: int) -> list[dict[str, Any]]:
        comments = self._get(
            f"/repos/{repo}/pulls/{pr_number}/comments",
            params={"per_page": 100},
        )
        return comments or []

    def list_pr_reviews(self, repo: str, pr_number: int) -> list[dict[str, Any]]:
        reviews = self._get(
            f"/repos/{repo}/pulls/{pr_number}/reviews",
            params={"per_page": 100},
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
    """Return (ok, reason). Checks star count and recent non-bot activity."""
    repo_data = client.get_repo(candidate.repository)
    if repo_data is None:
        return False, "repository not found"

    stars = repo_data.get("stargazers_count", 0)
    min_stars = 5000 if candidate.repo_type == "ui-library" else 1000
    if stars < min_stars:
        return False, f"stars={stars} < {min_stars}"

    # Check recent non-bot commit activity
    if candidate.repo_type == "ui-library":
        lookback_days = 30
    else:
        lookback_days = 90

    since = (now - timedelta(days=lookback_days)).isoformat()
    commits = client.list_commits(candidate.repository, since=since, per_page=50)
    non_bot = [
        c
        for c in commits
        if c.get("author")
        and c["author"].get("login") not in BOT_LOGINS
        and c.get("committer")
        and c["committer"].get("login") not in BOT_LOGINS
    ]
    if not non_bot:
        return False, f"no non-bot commits in last {lookback_days} days"

    # For applications, also check continuous activity over 6 months
    if candidate.repo_type == "application":
        since_6m = (now - timedelta(days=180)).isoformat()
        commits_6m = client.list_commits(
            candidate.repository, since=since_6m, per_page=100
        )
        non_bot_6m = [
            c
            for c in commits_6m
            if c.get("author") and c["author"].get("login") not in BOT_LOGINS
        ]
        if len(non_bot_6m) < 5:
            return (
                False,
                f"insufficient non-bot commits in 6 months ({len(non_bot_6m)})",
            )

    return True, f"stars={stars}, recent_non_bot={len(non_bot)}"


# ---------------------------------------------------------------------------
# PR scoring
# ---------------------------------------------------------------------------


def _text_score(text: str, keywords: list[str]) -> float:
    lower = text.lower()
    return sum(1.0 for kw in keywords if kw in lower)


def score_comment(text: str) -> tuple[float, float, float]:
    sec = _text_score(text, SECURITY_KEYWORDS)
    side = _text_score(text, SIDEEFFECT_KEYWORDS)
    design = _text_score(text, DESIGN_KEYWORDS)
    return sec, side, design


def score_pr(
    client: GitHubClient,
    candidate: RepoCandidate,
    pr: dict[str, Any],
) -> ScoredPR | None:
    pr_number = pr["number"]
    repo = candidate.repository

    # Collect review comments (inline) + review bodies.
    # PRs without inline comments are excluded: inline comments carry file path
    # and line number, which are required for location-based accuracy evaluation.
    inline = client.list_review_comments(repo, pr_number)
    if not inline:
        return None

    reviews = client.list_pr_reviews(repo, pr_number)

    all_comments: list[tuple[str, str]] = []
    for c in inline:
        login = (c.get("user") or {}).get("login", "")
        if login not in BOT_LOGINS and c.get("body"):
            all_comments.append((login, c["body"]))
    for r in reviews:
        login = (r.get("user") or {}).get("login", "")
        if login not in BOT_LOGINS and r.get("body") and len(r["body"].strip()) > 10:
            all_comments.append((login, r["body"]))

    if not all_comments:
        return None

    total_sec = total_side = total_design = 0.0
    sample: list[str] = []
    for _login, body in all_comments:
        sec, side, design = score_comment(body)
        total_sec += sec
        total_side += side
        total_design += design
        if sec > 0 or side > 0:
            preview = body[:200].replace("\n", " ")
            sample.append(preview)

    n = len(all_comments)
    # Normalize by comment count; penalize if design dominates
    design_ratio = total_design / max(total_design + total_sec + total_side, 1)
    penalty = design_ratio * 0.5

    raw = (total_sec * 2.0 + total_side * 1.5) / max(n, 1)
    final = max(raw - penalty, 0.0)

    return ScoredPR(
        repository=repo,
        repo_type=candidate.repo_type,
        stack=candidate.stack,
        pr_number=pr_number,
        title=pr.get("title", ""),
        merged_at=pr.get("merged_at", ""),
        security_score=round(total_sec / max(n, 1), 3),
        sideeffect_score=round(total_side / max(n, 1), 3),
        design_penalty=round(penalty, 3),
        total_score=round(final, 3),
        human_comment_count=n,
        sample_comments=sample[:3],
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Discover PR candidates for Gold-set")
    parser.add_argument(
        "--repos",
        default="evaluation/input/repo_candidates.json",
        help="Path to repo_candidates.json",
    )
    parser.add_argument(
        "--output",
        default="evaluation/input/pr_candidates_raw.json",
        help="Output path for ranked PR candidates",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=0.2,
        help="Minimum total_score to include in output",
    )
    parser.add_argument(
        "--since",
        default=None,
        help="Search PRs merged/updated after this date (ISO 8601). Default: 6 months ago.",
    )
    parser.add_argument(
        "--max-prs-per-repo",
        type=int,
        default=80,
        help="Max PRs to fetch per repo before scoring",
    )
    parser.add_argument(
        "--top-n-per-repo",
        type=int,
        default=20,
        help="Max top-scoring PRs to keep per repo in output",
    )
    parser.add_argument(
        "--skip-repos",
        default="",
        help="Comma-separated repos to skip (already processed)",
    )
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN not set")
        return 1

    client = GitHubClient(token)
    now = datetime.now(timezone.utc)

    since = args.since or (now - timedelta(days=180)).strftime("%Y-%m-%dT%H:%M:%SZ")

    skip_repos = {r.strip() for r in args.skip_repos.split(",") if r.strip()}

    with open(args.repos, encoding="utf-8") as f:
        raw_repos = json.load(f)
    candidates = [RepoCandidate(**r) for r in raw_repos]

    # Load existing results for append mode
    all_scored: list[ScoredPR] = []
    if skip_repos:
        try:
            with open(args.output, encoding="utf-8") as f:
                existing = json.load(f)
            for item in existing:
                if item["repository"] in skip_repos:
                    all_scored.append(ScoredPR(**item))
            print(f"Loaded {len(all_scored)} existing results from {args.output}")
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    for candidate in candidates:
        if candidate.repository in skip_repos:
            print(f"\n[{candidate.repository}] SKIP (already processed)")
            continue

        print(f"\n[{candidate.repository}] validating ...")
        try:
            ok, reason = validate_repo(client, candidate, now)
        except Exception as e:
            print(f"  SKIP: validation error: {e}")
            continue
        if not ok:
            print(f"  SKIP: {reason}")
            continue
        print(f"  OK: {reason}")

        # Use a shorter since window for ui-library (monthly requirement)
        if candidate.repo_type == "ui-library":
            pr_since = (now - timedelta(days=35)).strftime("%Y-%m-%dT%H:%M:%SZ")
        else:
            pr_since = since

        print(f"  fetching merged PRs since {pr_since[:10]} ...")
        try:
            prs = client.list_merged_prs(
                candidate.repository, since=pr_since, per_page=50
            )
        except Exception as e:
            print(f"  SKIP: failed to list PRs: {e}")
            continue
        print(f"  found {len(prs)} merged PRs")

        repo_scored: list[ScoredPR] = []
        for pr in prs[: args.max_prs_per_repo]:
            time.sleep(0.5)
            try:
                scored = score_pr(client, candidate, pr)
            except Exception as e:
                print(f"  WARN: PR #{pr['number']} scoring failed: {type(e).__name__}")
                time.sleep(2)
                continue
            if scored is None:
                continue
            if scored.total_score >= args.min_score:
                repo_scored.append(scored)

        repo_scored.sort(key=lambda x: x.total_score, reverse=True)
        top = repo_scored[: args.top_n_per_repo]
        print(f"  scored PRs passing threshold: {len(top)}")
        all_scored.extend(top)

        # Write incremental results after each repo
        _write_output(all_scored, args.output)
        print(f"  → saved to {args.output} (total: {len(all_scored)})")

        time.sleep(1)

    all_scored.sort(key=lambda x: x.total_score, reverse=True)
    _write_output(all_scored, args.output)

    print(f"\nTotal candidates written: {len(all_scored)} → {args.output}")
    print("\nTop 20 by score:")
    for s in all_scored[:20]:
        print(
            f"  [{s.total_score:.3f}] {s.repository}#{s.pr_number}"
            f" ({s.repo_type}/{s.stack}) {s.title[:60]}"
        )

    return 0


def _write_output(scored: list[ScoredPR], path: str) -> None:
    output = [
        asdict(s) for s in sorted(scored, key=lambda x: x.total_score, reverse=True)
    ]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
