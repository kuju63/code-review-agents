"""Shared GitHub REST API client for evaluation dataset builders.

Extracted from build_gold_set.py's inline ``_api_get`` so build_seeded_set.py
(Issue #224) can fetch real PR data without a second, drifting
reimplementation. build_gold_set.py itself is left untouched (Gold set
collection is out of scope for #224); the duplication between the two
call sites is accepted for now.
"""

from __future__ import annotations

import json
import urllib.request
from typing import Any


def api_get(url: str, token: str) -> Any:
    """GET a GitHub REST API URL and return the parsed JSON body.

    Args:
        url: Full GitHub REST API URL.
        token: GitHub personal access token, sent as a Bearer credential.

    Returns:
        The parsed JSON response body.
    """
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "code-review-agent-eval",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def fetch_pr_files(
    owner: str, repo: str, pr_number: int, token: str
) -> list[dict[str, Any]]:
    """Fetch changed files for a PR via GET /repos/{owner}/{repo}/pulls/{pr}/files.

    Pagination beyond the first 100 files is not implemented: none of the
    Issue #224 seed PRs approach that size, and this is a known limitation
    rather than an oversight.

    Args:
        owner: Repository owner.
        repo: Repository name.
        pr_number: Pull request number.
        token: GitHub personal access token.

    Returns:
        ``[{"path": ..., "patch": ...}, ...]`` for files that carry a patch
        (binary/renamed-without-diff files are skipped, matching GitHub's
        own omission of ``patch`` for those).
    """
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files?per_page=100"
    files_data = api_get(url, token)
    return [
        {"path": item["filename"], "patch": item["patch"]}
        for item in files_data
        if item.get("filename") and item.get("patch")
    ]
