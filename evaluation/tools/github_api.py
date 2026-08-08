"""Shared GitHub REST API client for evaluation dataset builders.

Extracted from build_gold_set.py's inline ``_api_get`` so build_seeded_set.py
(Issue #224) can fetch real PR data without a second, drifting
reimplementation. build_gold_set.py itself is left untouched (Gold set
collection is out of scope for #224); the duplication between the two
call sites is accepted for now.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any

_MAX_ATTEMPTS = 5
_BASE_BACKOFF_SECONDS = 1.0


def _is_rate_limited(error: urllib.error.HTTPError) -> bool:
    return error.code == 403 and error.headers.get("x-ratelimit-remaining") == "0"


def api_get(url: str, token: str) -> Any:
    """GET a GitHub REST API URL and return the parsed JSON body.

    Retries transient failures -- 429, rate-limited 403 (x-ratelimit-remaining
    == 0), 5xx responses, and network errors -- with bounded exponential
    backoff before propagating. A non-retryable HTTP error (e.g. 404) is
    raised immediately on the first attempt.

    Args:
        url: Full GitHub REST API URL.
        token: GitHub personal access token, sent as a Bearer credential.

    Returns:
        The parsed JSON response body.

    Raises:
        urllib.error.HTTPError: A non-retryable HTTP error, or one that
            persisted through all retry attempts.
        urllib.error.URLError: A network error that persisted through all
            retry attempts.
        RuntimeError: A rate-limit (403) error persisted through all retry
            attempts; the message includes ``x-ratelimit-reset`` so the
            caller knows when it's safe to retry.
        AssertionError: Never raised in practice -- the loop above always
            returns or raises before falling through; this satisfies the
            type checker's need for a guaranteed return.
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
    for attempt in range(_MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            rate_limited = _is_rate_limited(e)
            retryable = e.code == 429 or e.code >= 500 or rate_limited
            last_attempt = attempt == _MAX_ATTEMPTS - 1
            if not retryable or last_attempt:
                if rate_limited:
                    reset = e.headers.get("x-ratelimit-reset")
                    raise RuntimeError(
                        f"GitHub API rate limit exceeded (x-ratelimit-reset="
                        f"{reset}): {url}"
                    ) from e
                raise
        except urllib.error.URLError:
            if attempt == _MAX_ATTEMPTS - 1:
                raise
        time.sleep(_BASE_BACKOFF_SECONDS * (2**attempt))
    raise AssertionError("unreachable: loop above always returns or raises")


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
