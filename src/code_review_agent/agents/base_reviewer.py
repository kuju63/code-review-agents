"""Base classes for review agents in the parallel review stage.

Defines the reviewer interface (:class:`ReviewAgent`) and a shared LLM-backed
implementation (:class:`LLMReviewAgent`).  Concrete reviewers (React technical,
security, future stacks/perspectives) subclass these and supply only their
metadata and system prompt, so behavior is configured rather than re-coded.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import ClassVar, cast

from strands import Agent
from strands.models.openai import OpenAIModel
from strands.types.agent import Limits
from strands_tools import file_read, http_request

from ..models.review import (
    ProjectType,
    ReviewContext,
    ReviewOutput,
    ReviewPerspective,
    ReviewResult,
)
from ..skills.agent_skills_factory import AgentSkillType, create_agent_skills
from ..tools.github_mcp import GITHUB_MCP_URL, create_github_mcp_client


@dataclass(frozen=True)
class ReviewerConfig:
    """Shared runtime configuration injected into each reviewer.

    Attributes:
        github_token: GitHub token used for the GitHub MCP ``Authorization``
            header.
        model_id: OpenAI-compatible model ID used by every reviewer.
        mcp_url: GitHub MCP endpoint URL.
        max_agent_turns: Maximum agent loop iterations per invocation.
            Configurable via ``CODE_REVIEW_MAX_AGENT_TURNS``.
        reviewer_timeout_seconds: Per-reviewer wall-clock timeout in seconds.
            ``None`` disables the timeout (default).  When a reviewer exceeds
            this limit it is recorded as a :class:`ReviewError` and the other
            reviewers continue.  Configurable via
            ``CODE_REVIEW_REVIEWER_TIMEOUT_SECONDS``.
    """

    github_token: str
    model_id: str = "gpt-4o"
    mcp_url: str = GITHUB_MCP_URL
    llm_base_url: str | None = None
    max_agent_turns: int = 30
    reviewer_timeout_seconds: float | None = None


class ReviewAgent(ABC):
    """Interface for a reviewer in the parallel review stage.

    Subclasses declare their identity and scope via the class-level metadata
    and implement :meth:`review`.  The registry indexes reviewers by
    ``perspective`` x ``project_types``; the orchestrator instantiates them
    with a :class:`ReviewerConfig` and runs :meth:`review` concurrently.

    Class Attributes:
        reviewer_id: Stable identifier of the reviewer.
        perspective: The review perspective this reviewer covers.
        project_types: Project types this reviewer applies to.
    """

    reviewer_id: ClassVar[str]
    perspective: ClassVar[ReviewPerspective]
    project_types: ClassVar[frozenset[ProjectType]]

    def __init__(self, config: ReviewerConfig) -> None:
        self._config = config

    @abstractmethod
    def review(
        self,
        context: ReviewContext,
        project_type: ProjectType | None = None,
    ) -> ReviewResult:
        """Review the change described by ``context``.

        Args:
            context: Input boundary wrapping the collected PR information.
            project_type: The project type this review was selected for, used
                to annotate the result.  ``None`` when not scoped.

        Returns:
            The reviewer's findings wrapped with its identity metadata.
        """
        raise NotImplementedError


class LLMReviewAgent(ReviewAgent):
    """LLM-backed reviewer using a Strands ``Agent`` and GitHub MCP.

    Concrete reviewers set :attr:`system_prompt` (and optionally toggle
    :attr:`uses_github_mcp`).  The execution pattern mirrors
    :class:`~code_review_agent.agents.pr_info_collector.PRInfoCollector`:
    the GitHub MCP client is opened as a synchronous context manager and the
    agent produces a :class:`ReviewOutput` via ``structured_output``.

    Class Attributes:
        system_prompt: System prompt defining the reviewer's role and rules.
        uses_github_mcp: Whether to connect the GitHub MCP client so the agent
            can fetch additional repository files.
    """

    system_prompt: ClassVar[str]
    uses_github_mcp: ClassVar[bool] = True
    uses_url_fetch: ClassVar[bool] = False
    skill_type: ClassVar[AgentSkillType] = AgentSkillType.NONE

    def review(
        self,
        context: ReviewContext,
        project_type: ProjectType | None = None,
    ) -> ReviewResult:
        prompt = self._build_prompt(context)
        if self._config.llm_base_url:
            model = OpenAIModel(
                model_id=self._config.model_id,
                client_args={"base_url": self._config.llm_base_url},
            )
        else:
            model = OpenAIModel(model_id=self._config.model_id)

        tools: list = []
        # In strands >=1.41 ``MCPClient`` is a ``ToolProvider`` whose lifecycle
        # the Agent owns: it calls ``start()`` while loading tools and ``stop()``
        # on cleanup.  Opening it ourselves with ``with`` would start the session
        # a second time and raise "the client session is currently running", so we
        # hand the client to the Agent and stop it deterministically in ``finally``
        # (``stop`` is idempotent).
        mcp_client = None
        if self.uses_github_mcp:
            mcp_client = create_github_mcp_client(
                self._config.github_token, self._config.mcp_url
            )
            tools.append(mcp_client)

        if self.uses_url_fetch:
            tools.append(http_request)

        plugins: list = []
        if self.skill_type != AgentSkillType.NONE:
            tools.append(file_read)
            plugins.append(create_agent_skills(self.skill_type))

        try:
            agent = Agent(
                model=model,
                system_prompt=self.system_prompt,
                tools=tools,
                plugins=plugins,
            )
            limits: Limits = {"turns": self._config.max_agent_turns}
            output: ReviewOutput = cast(
                ReviewOutput,
                agent(
                    prompt,
                    structured_output_model=ReviewOutput,
                    limits=limits,
                ).structured_output,
            )
        finally:
            if mcp_client is not None:
                mcp_client.stop(None, None, None)

        return ReviewResult(
            reviewer_id=self.reviewer_id,
            perspective=self.perspective,
            project_type=project_type,
            output=output,
        )

    @staticmethod
    def _build_prompt(context: ReviewContext) -> str:
        """Serialize the review-relevant PR information into a prompt.

        Shared by every LLM reviewer so the perspective-specific guidance lives
        only in the system prompt, not in input formatting.

        Args:
            context: Input boundary wrapping the collected PR information.

        Returns:
            A human-readable prompt describing the repository, PR, dependency
            files, and per-file diffs.
        """
        pr = context.pr_info
        repo = pr.repository_info
        lines = [
            f"Repository: {repo.owner}/{repo.repository}",
            f"Project summary: {pr.project_summary}",
            "",
            f"PR #{pr.pr_info.pr_number}: {pr.pr_info.title}",
            f"Body: {pr.pr_info.body or '(none)'}",
            f"Labels: {', '.join(pr.pr_info.labels) or '(none)'}",
            f"Dependency files: {', '.join(pr.dependency_files) or '(none)'}",
            "",
            "Changed files (diff patches):",
        ]
        for change in pr.pr_info.file_changes:
            lines.append(f"--- {change.filePath} ---")
            lines.append(change.patch or "(patch unavailable; fetch via GitHub)")
        lines.append("")
        lines.append(
            "Only the modified sections are provided. Retrieve full files from "
            "GitHub as needed."
        )
        return "\n".join(lines)
