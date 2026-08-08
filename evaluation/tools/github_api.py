"""Shared GitHub REST API client for evaluation dataset builders.

Extracted from build_gold_set.py's inline ``_api_get`` so build_seeded_set.py
(Issue #224) can fetch real PR data without a second, drifting
reimplementation. build_gold_set.py itself is left untouched (Gold set
collection is out of scope for #224); the duplication between the two
call sites is accepted for now. Note that the two have since diverged in
security posture: this module adds URL/host allowlisting and redirect
restriction (see ``_RestrictedRedirectHandler``) that build_gold_set.py's
own ``_api_get`` does not have.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

_MAX_ATTEMPTS = 5
_BASE_BACKOFF_SECONDS = 1.0

_ALLOWED_SCHEME = "https"
_ALLOWED_HOST = "api.github.com"
_ALLOWED_PORTS = {None, 443}


def _is_rate_limited(error: urllib.error.HTTPError) -> bool:
    return error.code == 403 and error.headers.get("x-ratelimit-remaining") == "0"


def _is_allowed_url(url: str) -> bool:
    parsed = urllib.parse.urlsplit(url)
    return (
        parsed.scheme == _ALLOWED_SCHEME
        and parsed.hostname == _ALLOWED_HOST
        and parsed.port in _ALLOWED_PORTS
    )


class _RestrictedRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Only follows redirects that stay on https://api.github.com.

    Python's stdlib redirect handling forwards the Authorization header to
    the redirect target regardless of host -- unlike requests/httpx, it
    does not strip auth headers on cross-host redirects. Refusing any
    redirect that isn't https/api.github.com/default-port (returning
    ``None`` here makes ``urllib`` surface the original 3xx response as an
    ``HTTPError`` instead of following it) closes that gap without having
    to reimplement header stripping.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        if not _is_allowed_url(newurl):
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_RestrictedRedirectHandler())


def api_get(url: str, token: str) -> Any:
    """GET a GitHub REST API URL and return the parsed JSON body.

    Only ``https://api.github.com`` (default port) is accepted, and any
    redirect response is followed only if it also stays on that host --
    see ``_RestrictedRedirectHandler``. Retries transient failures -- 429,
    rate-limited 403 (x-ratelimit-remaining == 0), 5xx responses, and
    network errors -- with bounded exponential backoff before propagating.
    A non-retryable HTTP error (e.g. 404) is raised immediately on the
    first attempt.

    Args:
        url: Full GitHub REST API URL.
        token: GitHub personal access token, sent as a Bearer credential.

    Returns:
        The parsed JSON response body.

    Raises:
        ValueError: ``url`` is not ``https://api.github.com`` on the
            default port.
        urllib.error.HTTPError: A non-retryable HTTP error, one that
            persisted through all retry attempts, or a redirect refused by
            ``_RestrictedRedirectHandler``.
        urllib.error.URLError: A network error that persisted through all
            retry attempts.
        RuntimeError: A rate-limit (403) error persisted through all retry
            attempts; the message includes ``x-ratelimit-reset`` so the
            caller knows when it's safe to retry.
        AssertionError: Unreachable; the retry loop above always returns or
            raises before falling through.
    """
    if not _is_allowed_url(url):
        raise ValueError(f"refusing to call a non-https/api.github.com URL: {url}")

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
            with _opener.open(request, timeout=30) as response:
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

    Paginates through the full result set (100 files per page) rather than
    assuming everything fits on one page.

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
    per_page = 100
    files: list[dict[str, Any]] = []
    page = 1
    while True:
        url = (
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files"
            f"?per_page={per_page}&page={page}"
        )
        page_data = api_get(url, token)
        files.extend(
            {"path": item["filename"], "patch": item["patch"]}
            for item in page_data
            if item.get("filename") and item.get("patch")
        )
        if len(page_data) < per_page:
            break
        page += 1
    return files
