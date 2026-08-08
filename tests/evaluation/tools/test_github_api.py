"""Tests for evaluation/tools/github_api.py (Issue #224).

Covers api_get's URL/host allowlisting and redirect restriction, its
bounded-retry behavior for transient GitHub API failures (429, rate-limited
403, 5xx, network errors), and fetch_pr_files's pagination and mapping from
the GitHub REST response shape to the builder's simplified shape.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
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


class TestIsAllowedUrl:
    def test_accepts_https_api_github_com(self):
        assert github_api._is_allowed_url("https://api.github.com/repos/x/y") is True

    def test_accepts_explicit_default_port(self):
        assert (
            github_api._is_allowed_url("https://api.github.com:443/repos/x/y") is True
        )

    def test_rejects_http_scheme(self):
        assert github_api._is_allowed_url("http://api.github.com/repos/x/y") is False

    def test_rejects_other_host(self):
        assert github_api._is_allowed_url("https://evil.example.com/repos/x/y") is False

    def test_rejects_host_suffix_lookalike(self):
        # A naive `.endswith("api.github.com")` check would be fooled by
        # this; urlsplit().hostname must match exactly.
        assert (
            github_api._is_allowed_url("https://notapi.github.com/repos/x/y") is False
        )

    def test_rejects_non_default_port(self):
        assert (
            github_api._is_allowed_url("https://api.github.com:8443/repos/x/y") is False
        )


class TestRestrictedRedirectHandler:
    def _handler(self):
        return github_api._RestrictedRedirectHandler()

    def _request(self):
        return urllib.request.Request(
            "https://api.github.com/a", headers={"Authorization": "Bearer t"}
        )

    def test_allows_same_host_https_redirect(self):
        new_req = self._handler().redirect_request(
            self._request(), None, 302, "Found", Message(), "https://api.github.com/b"
        )
        assert new_req is not None
        assert new_req.full_url == "https://api.github.com/b"

    def test_refuses_cross_host_redirect(self):
        result = self._handler().redirect_request(
            self._request(),
            None,
            302,
            "Found",
            Message(),
            "https://evil.example.com/a",
        )
        assert result is None

    def test_refuses_scheme_downgrade_redirect(self):
        result = self._handler().redirect_request(
            self._request(), None, 302, "Found", Message(), "http://api.github.com/a"
        )
        assert result is None

    def test_refuses_non_default_port_redirect(self):
        result = self._handler().redirect_request(
            self._request(),
            None,
            302,
            "Found",
            Message(),
            "https://api.github.com:8443/a",
        )
        assert result is None


class TestApiGetUrlValidation:
    def test_rejects_disallowed_initial_url(self):
        with pytest.raises(ValueError, match="api\.github\.com"):
            api_get("https://evil.example.com/x", "token")

    def test_rejects_http_scheme_initial_url(self):
        with pytest.raises(ValueError, match="api\.github\.com"):
            api_get("http://api.github.com/x", "token")


class TestApiGetRetry:
    def test_succeeds_without_retry(self):
        with patch.object(
            github_api._opener, "open", return_value=_response({"ok": True})
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}

    def test_retries_on_5xx_then_succeeds(self):
        side_effect = _side_effect_sequence(_http_error(503), _response({"ok": True}))
        with (
            patch.object(github_api._opener, "open", side_effect=side_effect),
            patch.object(github_api.time, "sleep") as mock_sleep,
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}
        mock_sleep.assert_called_once()

    def test_retries_on_429_then_succeeds(self):
        side_effect = _side_effect_sequence(_http_error(429), _response({"ok": True}))
        with (
            patch.object(github_api._opener, "open", side_effect=side_effect),
            patch.object(github_api.time, "sleep"),
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}

    def test_retries_on_rate_limited_403_then_succeeds(self):
        rate_limited = _http_error(403, {"x-ratelimit-remaining": "0"})
        side_effect = _side_effect_sequence(rate_limited, _response({"ok": True}))
        with (
            patch.object(github_api._opener, "open", side_effect=side_effect),
            patch.object(github_api.time, "sleep"),
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}

    def test_does_not_retry_non_rate_limited_403(self):
        # A plain 403 (e.g. insufficient token scope) is not a rate limit
        # and should not be retried.
        with (
            patch.object(github_api._opener, "open", side_effect=_http_error(403)),
            patch.object(github_api.time, "sleep") as mock_sleep,
        ):
            with pytest.raises(urllib.error.HTTPError) as exc_info:
                api_get("https://api.github.com/x", "token")
            assert exc_info.value.code == 403
        mock_sleep.assert_not_called()

    def test_does_not_retry_non_retryable_404(self):
        with (
            patch.object(github_api._opener, "open", side_effect=_http_error(404)),
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
                github_api._opener, "open", side_effect=_http_error(403, headers)
            ),
            patch.object(github_api.time, "sleep"),
        ):
            with pytest.raises(RuntimeError, match="1234567890"):
                api_get("https://api.github.com/x", "token")

    def test_raises_after_exhausting_retries_on_persistent_5xx(self):
        with (
            patch.object(github_api._opener, "open", side_effect=_http_error(503)),
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
            patch.object(github_api._opener, "open", side_effect=side_effect),
            patch.object(github_api.time, "sleep"),
        ):
            assert api_get("https://api.github.com/x", "token") == {"ok": True}

    def test_raises_after_exhausting_retries_on_persistent_url_error(self):
        with (
            patch.object(
                github_api._opener,
                "open",
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
            "https://api.github.com/repos/kuju63/vue-seeded/pulls/8/files"
            "?per_page=100&page=1"
        )

    def test_paginates_beyond_the_first_page(self):
        # A PR with more than 100 changed files must not be silently
        # truncated to just the first page.
        first_page = [
            {"filename": f"file{i}.ts", "patch": f"+patch{i}"} for i in range(100)
        ]
        second_page = [{"filename": "file100.ts", "patch": "+patch100"}]
        responses = iter([first_page, second_page])

        with patch.object(
            github_api, "api_get", side_effect=lambda *a, **k: next(responses)
        ) as mock_get:
            result = fetch_pr_files("kuju63", "vue-seeded", 8, "token")

        assert len(result) == 101
        assert result[-1] == {"path": "file100.ts", "patch": "+patch100"}
        called_urls = [call.args[0] for call in mock_get.call_args_list]
        assert called_urls == [
            "https://api.github.com/repos/kuju63/vue-seeded/pulls/8/files"
            "?per_page=100&page=1",
            "https://api.github.com/repos/kuju63/vue-seeded/pulls/8/files"
            "?per_page=100&page=2",
        ]

    def test_stops_after_a_short_page_even_when_exactly_on_a_page_boundary(self):
        # An empty page (0 items) is also "short" and must stop the loop.
        with patch.object(github_api, "api_get", return_value=[]) as mock_get:
            result = fetch_pr_files("kuju63", "vue-seeded", 8, "token")
        assert result == []
        mock_get.assert_called_once()
