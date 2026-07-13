"""GitHub MCP client factory.

Provides a shared factory for creating MCPClient instances connected to
the GitHub MCP endpoint.  Centralising construction here ensures that all
agents use consistent auth headers and a single configuration point.
"""

import functools
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from anyio.streams.memory import MemoryObjectReceiveStream, MemoryObjectSendStream
from mcp.client.streamable_http import GetSessionIdCallback, streamable_http_client

# create_mcp_http_client is not re-exported from mcp.client.streamable_http (pyright
# flags that as reportPrivateImportUsage), so it must be imported from its actual
# defining module. This couples us to an internal mcp path, but it is the same path
# the deprecated streamablehttp_client relied on; pyright and the tests in
# test_github_mcp.py would catch it immediately if a future mcp release moves it.
from mcp.shared._httpx_utils import create_mcp_http_client
from mcp.shared.message import SessionMessage
from strands.tools.mcp import MCPClient
from strands.types.exceptions import MCPClientInitializationError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

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

    Uses ``create_mcp_http_client`` (the same factory the deprecated
    ``streamablehttp_client`` used internally) instead of a bare
    ``httpx.AsyncClient`` so the 30s/300s connect/SSE-read timeouts and
    ``follow_redirects=True`` are preserved; plain ``httpx.AsyncClient``
    defaults to a 5s timeout, which would time out long-lived SSE reads.
    """
    async with create_mcp_http_client(
        headers={"Authorization": f"Bearer {token}"}
    ) as http_client:
        async with streamable_http_client(url=url, http_client=http_client) as streams:
            yield streams


def create_github_mcp_client(
    token: str,
    url: str = GITHUB_MCP_URL,
    *,
    retry_attempts: int = 3,
    retry_backoff_seconds: float = 1.0,
) -> MCPClient:
    """Create an MCPClient connected to the GitHub MCP endpoint.

    Args:
        token: GitHub personal access token or Copilot token used for
            the ``Authorization: Bearer`` header.
        url: GitHub MCP endpoint URL.  Defaults to the read-only Copilot
            endpoint.
        retry_attempts: Maximum number of attempts (including the first) for
            the startup handshake, matching
            ``Settings.mcp_startup_retry_attempts``.
        retry_backoff_seconds: Base wait time in seconds for the exponential
            backoff+jitter between startup attempts, matching
            ``Settings.mcp_startup_retry_backoff_seconds``.

    Returns:
        A configured :class:`~strands.tools.mcp.MCPClient` instance ready
        to be used as a context manager.  ``start()`` is wrapped in-place with
        exponential backoff+jitter retry (ADR-0003) so every caller -- the
        direct ``start()`` path, the ``Agent``-owned ``load_tools()`` path, and
        the orchestrator's shared-client path -- gets the retry for free.
    """
    client = MCPClient(functools.partial(_github_mcp_transport, url=url, token=token))
    # Instance-level override rather than a ``MCPClient`` subclass: the latter
    # would make this factory return a different type than the one callers
    # patch in tests (``code_review_agent.tools.github_mcp.MCPClient``), and
    # ``MCPClient``/``ToolProvider`` define no ``__slots__`` that would block
    # assigning to ``start`` here.
    client.start = retry(
        stop=stop_after_attempt(retry_attempts),
        wait=wait_random_exponential(multiplier=retry_backoff_seconds),
        retry=retry_if_exception_type(MCPClientInitializationError),
        reraise=True,
    )(client.start)
    return client
