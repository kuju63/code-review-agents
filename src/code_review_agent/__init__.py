"""Code Review Agent — multi-agent code review orchestration."""

from .agents import PRInfoCollector
from .models import FileChange, PRInfo, PRInfoResult, RepositoryInfo
from .tools import GITHUB_MCP_URL, create_github_mcp_client

__all__ = [
    "PRInfoCollector",
    "RepositoryInfo",
    "FileChange",
    "PRInfo",
    "PRInfoResult",
    "create_github_mcp_client",
    "GITHUB_MCP_URL",
]


def main() -> None:
    """Entry point placeholder."""
    print("Hello from code-review-agent!")
