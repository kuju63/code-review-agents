"""GitHub MCP client factory.

Provides a shared factory for creating MCPClient instances connected to
the GitHub MCP endpoint.  Centralising construction here ensures that all
agents use consistent auth headers and a single configuration point.
"""

import functools

from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/read-only"


def create_github_mcp_client(
    token: str,
    url: str = GITHUB_MCP_URL,
) -> MCPClient:
    """Create an MCPClient connected to the GitHub MCP endpoint.

    Args:
        token: GitHub personal access token or Copilot token used for
            the ``Authorization: Bearer`` header.
        url: GitHub MCP endpoint URL.  Defaults to the read-only Copilot
            endpoint.

    Returns:
        A configured :class:`~strands.tools.mcp.MCPClient` instance ready
        to be used as a context manager.
    """
    return MCPClient(
        functools.partial(
            streamablehttp_client,
            url=url,
            headers={"Authorization": f"Bearer {token}"},
        )
    )
