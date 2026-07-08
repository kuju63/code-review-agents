"""Tests for GitHub MCP client factory."""

from unittest.mock import AsyncMock, patch

import pytest
from strands.tools.mcp import MCPClient

from code_review_agent.tools.github_mcp import (
    GITHUB_MCP_URL,
    _github_mcp_transport,
    create_github_mcp_client,
)


class TestGitHubMCPURL:
    def test_default_url(self):
        assert GITHUB_MCP_URL == "https://api.githubcopilot.com/mcp/read-only"


class TestCreateGitHubMcpClient:
    def test_returns_mcp_client(self):
        with patch("code_review_agent.tools.github_mcp.MCPClient") as mock_cls:
            mock_cls.return_value = object()
            result = create_github_mcp_client("mytoken")
            mock_cls.assert_called_once()
            assert result is mock_cls.return_value

    def test_uses_default_url(self):
        with patch("code_review_agent.tools.github_mcp.MCPClient") as mock_cls:
            create_github_mcp_client("tok")
            transport_callable = mock_cls.call_args.args[0]
            # The callable is a functools.partial; inspect its keywords
            assert transport_callable.keywords["url"] == GITHUB_MCP_URL

    def test_uses_custom_url(self):
        custom_url = "https://custom.example.com/mcp"
        with patch("code_review_agent.tools.github_mcp.MCPClient") as mock_cls:
            create_github_mcp_client("tok", url=custom_url)
            transport_callable = mock_cls.call_args.args[0]
            assert transport_callable.keywords["url"] == custom_url

    def test_token_passed_to_transport(self):
        with patch("code_review_agent.tools.github_mcp.MCPClient") as mock_cls:
            create_github_mcp_client("secret-token")
            transport_callable = mock_cls.call_args.args[0]
            assert transport_callable.func is _github_mcp_transport
            assert transport_callable.keywords["token"] == "secret-token"

    def test_is_mcp_client_type(self):
        client = create_github_mcp_client("tok")
        assert isinstance(client, MCPClient)


class TestGithubMcpTransport:
    """Verifies the httpx.AsyncClient ownership design from Issue #43.

    ``streamable_http_client`` never closes an ``http_client`` it did not create
    itself, so ``_github_mcp_transport`` must create, use, and close the
    ``httpx.AsyncClient`` entirely within its own coroutine.
    """

    @pytest.mark.asyncio
    async def test_builds_httpx_client_with_bearer_header(self):
        mock_http_client = AsyncMock()
        mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_http_client.__aexit__ = AsyncMock(return_value=False)

        mock_streams = ("read_stream", "write_stream", None)
        mock_streamable_cm = AsyncMock()
        mock_streamable_cm.__aenter__ = AsyncMock(return_value=mock_streams)
        mock_streamable_cm.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "code_review_agent.tools.github_mcp.httpx.AsyncClient",
                return_value=mock_http_client,
            ) as mock_async_client_cls,
            patch(
                "code_review_agent.tools.github_mcp.streamable_http_client",
                return_value=mock_streamable_cm,
            ) as mock_streamable,
        ):
            async with _github_mcp_transport(
                "https://example.com/mcp", "secret-token"
            ) as streams:
                assert streams == mock_streams

        mock_async_client_cls.assert_called_once_with(
            headers={"Authorization": "Bearer secret-token"}
        )
        mock_streamable.assert_called_once_with(
            url="https://example.com/mcp", http_client=mock_http_client
        )

    @pytest.mark.asyncio
    async def test_closes_httpx_client_on_scope_exit(self):
        mock_http_client = AsyncMock()
        mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_http_client.__aexit__ = AsyncMock(return_value=False)

        mock_streamable_cm = AsyncMock()
        mock_streamable_cm.__aenter__ = AsyncMock(return_value=("r", "w", None))
        mock_streamable_cm.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "code_review_agent.tools.github_mcp.httpx.AsyncClient",
                return_value=mock_http_client,
            ),
            patch(
                "code_review_agent.tools.github_mcp.streamable_http_client",
                return_value=mock_streamable_cm,
            ),
        ):
            async with _github_mcp_transport("https://example.com/mcp", "tok"):
                mock_http_client.__aexit__.assert_not_awaited()

        # The httpx.AsyncClient must be closed by the time the transport's own
        # scope exits -- this is what makes _github_mcp_transport, not the
        # MCPClient caller, the owner of the client's lifecycle.
        mock_http_client.__aexit__.assert_awaited_once()
        mock_streamable_cm.__aexit__.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_closes_httpx_client_when_body_raises(self):
        mock_http_client = AsyncMock()
        mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_http_client.__aexit__ = AsyncMock(return_value=False)

        mock_streamable_cm = AsyncMock()
        mock_streamable_cm.__aenter__ = AsyncMock(return_value=("r", "w", None))
        mock_streamable_cm.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "code_review_agent.tools.github_mcp.httpx.AsyncClient",
                return_value=mock_http_client,
            ),
            patch(
                "code_review_agent.tools.github_mcp.streamable_http_client",
                return_value=mock_streamable_cm,
            ),
        ):
            with pytest.raises(RuntimeError):
                async with _github_mcp_transport("https://example.com/mcp", "tok"):
                    raise RuntimeError("boom")

        mock_http_client.__aexit__.assert_awaited_once()
