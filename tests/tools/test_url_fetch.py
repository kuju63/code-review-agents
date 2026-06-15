"""Tests for URL fetch tool factory."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from code_review_agent.tools.url_fetch import (
    URLFetchConfig,
    _strip_html,
    _validate_url,
    create_url_fetch_tool,
)


class TestURLFetchConfig:
    def test_defaults(self):
        cfg = URLFetchConfig()
        assert cfg.model_id == "gpt-4o"
        assert cfg.llm_base_url is None
        assert cfg.timeout_seconds == 10
        assert cfg.max_raw_chars == 50_000

    def test_custom_values(self):
        cfg = URLFetchConfig(
            model_id="gpt-4o-mini", llm_base_url="http://local", timeout_seconds=5
        )
        assert cfg.model_id == "gpt-4o-mini"
        assert cfg.llm_base_url == "http://local"
        assert cfg.timeout_seconds == 5


class TestValidateURL:
    def test_http_allowed(self):
        _validate_url("http://example.com/doc")  # must not raise

    def test_https_allowed(self):
        _validate_url("https://owasp.org/Top10/2025/")  # must not raise

    def test_file_scheme_rejected(self):
        with pytest.raises(ValueError, match="file"):
            _validate_url("file:///etc/passwd")

    def test_ftp_scheme_rejected(self):
        with pytest.raises(ValueError, match="ftp"):
            _validate_url("ftp://example.com/file")

    def test_data_scheme_rejected(self):
        with pytest.raises(ValueError, match="data"):
            _validate_url("data:text/html,<h1>hi</h1>")

    def test_empty_scheme_rejected(self):
        with pytest.raises(ValueError):
            _validate_url("example.com/no-scheme")


class TestStripHTML:
    def test_removes_tags(self):
        html = "<h1>Title</h1><p>Body text</p>"
        result = _strip_html(html)
        assert "Title" in result
        assert "Body text" in result
        assert "<h1>" not in result
        assert "<p>" not in result

    def test_skips_script_content(self):
        html = "<p>Visible</p><script>alert('xss')</script>"
        result = _strip_html(html)
        assert "Visible" in result
        assert "alert" not in result

    def test_skips_style_content(self):
        html = "<p>Visible</p><style>body { color: red; }</style>"
        result = _strip_html(html)
        assert "Visible" in result
        assert "color" not in result

    def test_empty_html(self):
        assert _strip_html("") == ""

    def test_plain_text_unchanged(self):
        result = _strip_html("no tags here")
        assert "no tags here" in result


class TestCreateUrlFetchTool:
    """Tests for the @tool closure returned by create_url_fetch_tool."""

    def _make_response(
        self, text: str, content_type: str = "text/html", status: int = 200
    ):
        resp = MagicMock(spec=httpx.Response)
        resp.text = text
        resp.headers = {"content-type": content_type}
        resp.status_code = status
        resp.raise_for_status = MagicMock()
        return resp

    def test_returns_callable(self):
        tool = create_url_fetch_tool(URLFetchConfig())
        assert callable(tool)

    @patch("code_review_agent.tools.url_fetch.Agent")
    @patch("code_review_agent.tools.url_fetch.httpx.get")
    def test_fetch_html_content(self, mock_get, mock_agent_cls):
        mock_get.return_value = self._make_response("<p>OWASP content</p>")
        mock_agent_cls.return_value.return_value = "OWASP summary"

        tool = create_url_fetch_tool(URLFetchConfig())
        result = tool("https://owasp.org/Top10/")

        mock_get.assert_called_once_with(
            "https://owasp.org/Top10/",
            timeout=10,
            follow_redirects=True,
        )
        assert "https://owasp.org/Top10/" in result
        assert "OWASP summary" in result

    @patch("code_review_agent.tools.url_fetch.Agent")
    @patch("code_review_agent.tools.url_fetch.httpx.get")
    def test_fetch_json_content_no_html_strip(self, mock_get, mock_agent_cls):
        json_body = '{"key": "value"}'
        mock_get.return_value = self._make_response(
            json_body, content_type="application/json"
        )
        mock_agent_cls.return_value.return_value = "JSON summary"

        tool = create_url_fetch_tool(URLFetchConfig())
        tool("https://example.com/data.json")

        # Verify Agent was called with raw JSON (not stripped)
        call_args = mock_agent_cls.return_value.call_args
        prompt_arg = call_args.args[0]
        assert json_body in prompt_arg

    @patch("code_review_agent.tools.url_fetch.httpx.get")
    def test_http_error_returns_error_string(self, mock_get):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 404
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Not Found", request=MagicMock(), response=mock_resp
        )
        mock_get.return_value = mock_resp

        tool = create_url_fetch_tool(URLFetchConfig())
        result = tool("https://example.com/missing")

        assert result.startswith("[url_fetch error]")
        assert "404" in result

    @patch("code_review_agent.tools.url_fetch.httpx.get")
    def test_timeout_returns_error_string(self, mock_get):
        mock_get.side_effect = httpx.TimeoutException("timeout")

        tool = create_url_fetch_tool(URLFetchConfig())
        result = tool("https://slow.example.com/")

        assert result.startswith("[url_fetch error]")
        assert "timed out" in result

    def test_invalid_scheme_returns_error_string(self):
        tool = create_url_fetch_tool(URLFetchConfig())
        result = tool("file:///etc/passwd")

        assert result.startswith("[url_fetch error]")

    @patch("code_review_agent.tools.url_fetch.Agent")
    @patch("code_review_agent.tools.url_fetch.httpx.get")
    def test_max_raw_chars_truncates(self, mock_get, mock_agent_cls):
        long_content = "A" * 100_000
        mock_get.return_value = self._make_response(
            long_content, content_type="text/plain"
        )
        mock_agent_cls.return_value.return_value = "truncated summary"

        cfg = URLFetchConfig(max_raw_chars=500)
        tool = create_url_fetch_tool(cfg)
        tool("https://example.com/large")

        call_args = mock_agent_cls.return_value.call_args
        prompt_arg = call_args.args[0]
        # The content passed to LLM should be at most max_raw_chars characters
        # (within the full prompt, the content portion is capped)
        assert len(prompt_arg) < 100_000

    @patch("code_review_agent.tools.url_fetch.Agent")
    @patch("code_review_agent.tools.url_fetch.httpx.get")
    def test_focus_passed_to_summarizer(self, mock_get, mock_agent_cls):
        mock_get.return_value = self._make_response("<p>Security content</p>")
        mock_agent_cls.return_value.return_value = "focused summary"

        tool = create_url_fetch_tool(URLFetchConfig())
        tool("https://owasp.org/", focus="CSRF prevention techniques")

        call_args = mock_agent_cls.return_value.call_args
        prompt_arg = call_args.args[0]
        assert "CSRF prevention techniques" in prompt_arg

    @patch("code_review_agent.tools.url_fetch.Agent")
    @patch("code_review_agent.tools.url_fetch.httpx.get")
    def test_source_url_in_result(self, mock_get, mock_agent_cls):
        mock_get.return_value = self._make_response("<p>content</p>")
        mock_agent_cls.return_value.return_value = "summary"

        tool = create_url_fetch_tool(URLFetchConfig())
        result = tool("https://example.com/doc")

        assert "[Source: https://example.com/doc]" in result

    @patch("code_review_agent.tools.url_fetch.Agent")
    @patch("code_review_agent.tools.url_fetch.httpx.get")
    def test_uses_custom_llm_base_url(self, mock_get, mock_agent_cls):
        mock_get.return_value = self._make_response("<p>content</p>")
        mock_agent_cls.return_value.return_value = "summary"

        cfg = URLFetchConfig(llm_base_url="http://localhost:8080/v1")
        tool = create_url_fetch_tool(cfg)
        tool("https://example.com/doc")

        # OpenAIModel should have been called with custom base_url
        with patch("code_review_agent.tools.url_fetch.OpenAIModel") as mock_model:
            mock_agent_cls.return_value.return_value = "summary"
            tool2 = create_url_fetch_tool(cfg)
            mock_get.return_value = self._make_response("<p>content</p>")
            tool2("https://example.com/doc")
            mock_model.assert_called_once_with(
                model_id=cfg.model_id,
                client_args={"base_url": "http://localhost:8080/v1"},
            )
