"""Tests for GitHub MCP client factory."""

from unittest.mock import patch

from strands.tools.mcp import MCPClient

from code_review_agent.tools.github_mcp import (
    GITHUB_MCP_URL,
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

    def test_bearer_token_in_headers(self):
        with patch("code_review_agent.tools.github_mcp.MCPClient") as mock_cls:
            create_github_mcp_client("secret-token")
            transport_callable = mock_cls.call_args.args[0]
            assert transport_callable.keywords["headers"] == {
                "Authorization": "Bearer secret-token"
            }

    def test_is_mcp_client_type(self):
        client = create_github_mcp_client("tok")
        assert isinstance(client, MCPClient)
