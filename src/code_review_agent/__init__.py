"""Code Review Agent — multi-agent code review orchestration."""

from .agents import (
    LLMReviewAgent,
    PRInfoCollector,
    ReactCodeReviewer,
    ReviewAgent,
    ReviewerConfig,
    SecurityReviewer,
    detect_project_types,
    get_reviewer_classes,
    register_reviewer,
)
from .agents.review_orchestrator import ReviewOrchestrator
from .models import (
    FileChange,
    PRInfo,
    PRInfoResult,
    ProjectType,
    RepositoryInfo,
    ReviewContext,
    ReviewError,
    ReviewFinding,
    ReviewOutput,
    ReviewPerspective,
    ReviewPriority,
    ReviewReport,
    ReviewResult,
)
from .tools import GITHUB_MCP_URL, create_github_mcp_client

__all__ = [
    "PRInfoCollector",
    "RepositoryInfo",
    "FileChange",
    "PRInfo",
    "PRInfoResult",
    "create_github_mcp_client",
    "GITHUB_MCP_URL",
    # Review stage
    "ProjectType",
    "ReviewPerspective",
    "ReviewPriority",
    "ReviewFinding",
    "ReviewOutput",
    "ReviewContext",
    "ReviewResult",
    "ReviewError",
    "ReviewReport",
    "ReviewAgent",
    "LLMReviewAgent",
    "ReviewerConfig",
    "ReactCodeReviewer",
    "SecurityReviewer",
    "register_reviewer",
    "get_reviewer_classes",
    "detect_project_types",
    "ReviewOrchestrator",
]


def main() -> None:
    """Start the A2A HTTP server."""
    import uvicorn

    from .api.app import create_app
    from .api.config import Settings

    settings = Settings()
    app = create_app(settings)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
    )
