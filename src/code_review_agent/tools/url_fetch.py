"""URL fetch tool for review agents.

Provides a factory that returns a Strands @tool-decorated function capable of
fetching external documents (OWASP, MDN, CWE, etc.) and summarising them with
an LLM.  Design is intentionally analogous to create_github_mcp_client: callers
pass a URLFetchConfig and receive a configured tool ready to be added to an
Agent's tools list.
"""

import ipaddress
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from strands import Agent, tool
from strands.models.openai import OpenAIModel

_ALLOWED_SCHEMES = frozenset({"http", "https"})

_SUMMARIZER_SYSTEM_PROMPT = (
    "You are a technical document summarizer. Extract and present the key "
    "technical information from the provided content concisely and accurately. "
    "If a focus topic is specified, prioritise information related to that topic "
    "and omit unrelated details."
)


@dataclass(frozen=True)
class URLFetchConfig:
    """Configuration for the URL fetch tool.

    Attributes:
        model_id: OpenAI-compatible model ID used for summarisation.
        llm_base_url: Optional base URL for an OpenAI-compatible endpoint.
        timeout_seconds: HTTP request timeout in seconds.
        max_raw_chars: Maximum characters of raw content passed to the LLM.
    """

    model_id: str = "gpt-4o"
    llm_base_url: str | None = None
    timeout_seconds: int = 10
    max_raw_chars: int = 50_000


class _HTMLTextExtractor(HTMLParser):
    """Strip HTML tags and skip script/style block content."""

    def __init__(self) -> None:
        super().__init__()
        self._skip = False
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip = False

    def handle_data(self, data: str) -> None:
        if not self._skip:
            text = data.strip()
            if text:
                self._parts.append(text)

    def get_text(self) -> str:
        return "\n".join(self._parts)


def _strip_html(html: str) -> str:
    extractor = _HTMLTextExtractor()
    extractor.feed(html)
    return extractor.get_text()


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise ValueError(
            f"URL scheme '{parsed.scheme}' is not allowed; use http or https"
        )
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL must include a non-empty hostname")
    # Block IP literals that map to private, loopback, or link-local ranges
    # (e.g. 127.0.0.1, 169.254.169.254/AWS metadata, 10.x, 192.168.x).
    # DNS-name hosts are not blocked here; the network layer enforces those.
    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        return  # Not an IP literal — regular hostname, allowed
    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
        raise ValueError(f"URL hostname '{hostname}' is a private or reserved address")


def _summarize(text: str, url: str, focus: str, config: URLFetchConfig) -> str:
    if config.llm_base_url:
        model = OpenAIModel(
            model_id=config.model_id,
            client_args={"base_url": config.llm_base_url},
        )
    else:
        model = OpenAIModel(model_id=config.model_id)

    agent = Agent(model=model, system_prompt=_SUMMARIZER_SYSTEM_PROMPT, tools=[])
    focus_clause = f"\n\nFocus on: {focus}" if focus else ""
    prompt = f"Summarise the following content from {url}.{focus_clause}\n\n{text}"
    return str(agent(prompt))


def create_url_fetch_tool(config: URLFetchConfig):
    """Return a configured fetch_url_content Strands tool.

    Analogous to create_github_mcp_client: wraps configuration in a closure
    so callers can simply pass the returned callable to an Agent's tools list.

    Args:
        config: URLFetchConfig controlling model, timeout, and size limits.

    Returns:
        A @tool-decorated callable ready for use in ``Agent(..., tools=[...])``.
    """

    @tool
    def fetch_url_content(url: str, focus: str = "") -> str:
        """Fetch content from a URL and return an LLM-generated summary.

        Use this to retrieve external reference documents such as security
        standards, API documentation, or advisory pages relevant to the review.
        Only HTTP and HTTPS URLs are accepted.

        Args:
            url: HTTP or HTTPS URL to fetch content from.
            focus: Optional description of what aspect to focus on in the
                   summary.  Example: "CSRF prevention techniques" or
                   "CVE risk levels for authentication libraries".

        Returns:
            A focused summary of the fetched content prefixed with the source
            URL, or an error message string if the fetch failed.
        """
        try:
            _validate_url(url)
        except ValueError as exc:
            return f"[url_fetch error] {exc}"

        try:
            response = httpx.get(
                url,
                timeout=config.timeout_seconds,
                follow_redirects=False,
            )
            response.raise_for_status()
        except httpx.TimeoutException:
            return (
                f"[url_fetch error] Request timed out after "
                f"{config.timeout_seconds}s: {url}"
            )
        except httpx.HTTPStatusError as exc:
            return f"[url_fetch error] HTTP {exc.response.status_code}: {url}"
        except httpx.HTTPError as exc:
            return f"[url_fetch error] {exc}"

        content_type = response.headers.get("content-type", "")
        raw_text = response.text

        if "html" in content_type:
            text = _strip_html(raw_text)
        else:
            text = raw_text

        text = text[: config.max_raw_chars]
        try:
            summary = _summarize(text, url, focus, config)
        except Exception as exc:
            return f"[url_fetch error] Summarization failed: {exc}"
        return f"[Source: {url}]\n{summary}"

    return fetch_url_content
