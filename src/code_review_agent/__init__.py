"""Code Review Agent — multi-agent code review orchestration."""

from .agents import (
    FrontendReviewer,
    LLMReviewAgent,
    PRInfoCollector,
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
    "FrontendReviewer",
    "SecurityReviewer",
    "register_reviewer",
    "get_reviewer_classes",
    "detect_project_types",
    "ReviewOrchestrator",
]


def main() -> None:
    """Start the A2A HTTP server."""
    import uvicorn
    from dotenv import load_dotenv

    from .api.app import create_app
    from .api.config import Settings

    # Load .env into the process environment so the LLM SDK (which reads the
    # unprefixed OPENAI_API_KEY) and any non-CODE_REVIEW_ credentials are
    # available without exporting them in the shell.  load_dotenv() does not
    # override variables already set, so a shell export still takes precedence.
    load_dotenv()

    settings = Settings()
    app = create_app(settings)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
    )
