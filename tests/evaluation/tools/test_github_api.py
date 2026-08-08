"""Tests for evaluation/tools/github_api.py (Issue #224).

Covers api_get's bounded-retry behavior for transient GitHub API failures
(429, rate-limited 403, 5xx, network errors) and fetch_pr_files's mapping
from the GitHub REST response shape to the builder's simplified shape.
"""

from __future__ import annotations

import json
import urllib.error
from email.message import Message
from unittest.mock import MagicMock, patch

import pytest

from tests.evaluation.conftest import load_eval_tool_module

github_api = load_eval_tool_module("github_api", "github_api.py")

api_get = github_api.api_get
fetch_pr_files = github_api.fetch_pr_files


def _http_error(
    code: int, headers: dict[str, str] | None = None
) -> urllib.error.HTTPError:
    hdrs = Message()
    for key, value in (headers or {}).items():
        hdrs[key] = value
    return urllib.error.HTTPError(
        url="https://api.github.com/x",
        code=code,
        msg="error",
        hdrs=hdrs,
        fp=None,
    )


def _response(body):
    response = MagicMock()
    response.__enter__.return_value = response
    response.read.return_value = json.dumps(body).encode("utf-8")
    return response


def _side_effect_sequence(*results):
    remaining = list(results)

    def side_effect(*args, **kwargs):
        result = remaining.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    return side_effect


class TestApiGetRetry:
    def test_succeeds_without_retry(self):
        with patch.object(
            github_api.urllib.request, "urlopen", return_value=_response({"ok": True})
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}

    def test_retries_on_5xx_then_succeeds(self):
        side_effect = _side_effect_sequence(_http_error(503), _response({"ok": True}))
        with (
            patch.object(github_api.urllib.request, "urlopen", side_effect=side_effect),
            patch.object(github_api.time, "sleep") as mock_sleep,
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}
        mock_sleep.assert_called_once()

    def test_retries_on_429_then_succeeds(self):
        side_effect = _side_effect_sequence(_http_error(429), _response({"ok": True}))
        with (
            patch.object(github_api.urllib.request, "urlopen", side_effect=side_effect),
            patch.object(github_api.time, "sleep"),
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}

    def test_retries_on_rate_limited_403_then_succeeds(self):
        rate_limited = _http_error(403, {"x-ratelimit-remaining": "0"})
        side_effect = _side_effect_sequence(rate_limited, _response({"ok": True}))
        with (
            patch.object(github_api.urllib.request, "urlopen", side_effect=side_effect),
            patch.object(github_api.time, "sleep"),
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}

    def test_does_not_retry_non_rate_limited_403(self):
        # A plain 403 (e.g. insufficient token scope) is not a rate limit
        # and should not be retried.
        with (
            patch.object(
                github_api.urllib.request, "urlopen", side_effect=_http_error(403)
            ),
            patch.object(github_api.time, "sleep") as mock_sleep,
        ):
            with pytest.raises(urllib.error.HTTPError) as exc_info:
                api_get("https://api.github.com/x", "token")
            assert exc_info.value.code == 403
        mock_sleep.assert_not_called()

    def test_does_not_retry_non_retryable_404(self):
        with (
            patch.object(
                github_api.urllib.request, "urlopen", side_effect=_http_error(404)
            ),
            patch.object(github_api.time, "sleep") as mock_sleep,
        ):
            with pytest.raises(urllib.error.HTTPError) as exc_info:
                api_get("https://api.github.com/x", "token")
            assert exc_info.value.code == 404
        mock_sleep.assert_not_called()

    def test_raises_runtime_error_with_reset_after_persistent_rate_limit(self):
        headers = {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1234567890"}
        with (
            patch.object(
                github_api.urllib.request,
                "urlopen",
                side_effect=_http_error(403, headers),
            ),
            patch.object(github_api.time, "sleep"),
        ):
            with pytest.raises(RuntimeError, match="1234567890"):
                api_get("https://api.github.com/x", "token")

    def test_raises_after_exhausting_retries_on_persistent_5xx(self):
        with (
            patch.object(
                github_api.urllib.request, "urlopen", side_effect=_http_error(503)
            ),
            patch.object(github_api.time, "sleep") as mock_sleep,
        ):
            with pytest.raises(urllib.error.HTTPError):
                api_get("https://api.github.com/x", "token")
        assert mock_sleep.call_count == github_api._MAX_ATTEMPTS - 1

    def test_retries_on_url_error_then_succeeds(self):
        side_effect = _side_effect_sequence(
            urllib.error.URLError("network down"), _response({"ok": True})
        )
        with (
            patch.object(github_api.urllib.request, "urlopen", side_effect=side_effect),
            patch.object(github_api.time, "sleep"),
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}

    def test_raises_after_exhausting_retries_on_persistent_url_error(self):
        with (
            patch.object(
                github_api.urllib.request,
                "urlopen",
                side_effect=urllib.error.URLError("network down"),
            ),
            patch.object(github_api.time, "sleep") as mock_sleep,
        ):
            with pytest.raises(urllib.error.URLError):
                api_get("https://api.github.com/x", "token")
        assert mock_sleep.call_count == github_api._MAX_ATTEMPTS - 1


class TestFetchPrFiles:
    def test_maps_filename_and_patch_and_skips_files_without_patch(self):
        payload = [
            {"filename": "a.ts", "patch": "+const a = 1;"},
            {"filename": "b.png", "status": "added"},  # binary file: no patch
        ]
        with patch.object(github_api, "api_get", return_value=payload) as mock_get:
            result = fetch_pr_files("kuju63", "vue-seeded", 8, "token")
        assert result == [{"path": "a.ts", "patch": "+const a = 1;"}]
        called_url = mock_get.call_args[0][0]
        assert called_url == (
            "https://api.github.com/repos/kuju63/vue-seeded/pulls/8/files?per_page=100"
        )
