"""GitHub MCP client factory.

Provides a shared factory for creating MCPClient instances connected to
the GitHub MCP endpoint.  Centralising construction here ensures that all
agents use consistent auth headers and a single configuration point.
"""

import functools
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
from anyio.streams.memory import MemoryObjectReceiveStream, MemoryObjectSendStream
from mcp.client.streamable_http import GetSessionIdCallback, streamable_http_client
from mcp.shared.message import SessionMessage
from strands.tools.mcp import MCPClient

GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/read-only"

# The 3-tuple actually yielded by ``streamable_http_client``: read stream, write
# stream, and a callback to fetch the negotiated MCP session id.
_MCPStreams = tuple[
    MemoryObjectReceiveStream[SessionMessage | Exception],
    MemoryObjectSendStream[SessionMessage],
    GetSessionIdCallback,
]


@asynccontextmanager
async def _github_mcp_transport(
    url: str, token: str
) -> AsyncGenerator[_MCPStreams, None]:
    """Transport for ``MCPClient`` that owns the ``httpx.AsyncClient`` lifecycle.

    ``streamable_http_client`` only manages the ``httpx.AsyncClient`` lifecycle
    (open/close) when it creates the client itself; a caller-supplied client is
    left untouched. This coroutine is invoked by ``MCPClient`` entirely within
    its background thread's single event loop, so creating, using, and closing
    the ``httpx.AsyncClient`` here (rather than in the caller's thread) avoids
    releasing an async resource across event loops.
    """
    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {token}"}
    ) as http_client:
        async with streamable_http_client(url=url, http_client=http_client) as streams:
            yield streams


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
    return MCPClient(functools.partial(_github_mcp_transport, url=url, token=token))
