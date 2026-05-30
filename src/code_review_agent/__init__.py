"""Code Review Agent — multi-agent code review orchestration."""

from .agents import PRInfoCollector
from .models import FileChange, PRInfo, PRInfoResult, RepositoryInfo

__all__ = [
    "PRInfoCollector",
    "RepositoryInfo",
    "FileChange",
    "PRInfo",
    "PRInfoResult",
]


def main() -> None:
    """Entry point placeholder."""
    print("Hello from code-review-agent!")
