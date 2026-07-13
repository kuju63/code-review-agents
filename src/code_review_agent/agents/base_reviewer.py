"""Base classes for review agents in the parallel review stage.

Defines the reviewer interface (:class:`ReviewAgent`) and a shared LLM-backed
implementation (:class:`LLMReviewAgent`).  Concrete reviewers (React technical,
security, future stacks/perspectives) subclass these and supply only their
metadata and system prompt, so behavior is configured rather than re-coded.
"""

import re
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
from .exceptions import StructuredOutputMissingError


# Small models (e.g. granite4.1:8b) tend to end their turn with a free-form
# Markdown review report instead of invoking the forced structured-output tool.
# Strands then raises "The model failed to invoke the structured output tool even
# after it was forced" (strands/event_loop/event_loop.py: end_turn + force path),
# and the whole review is lost.  ``LLMReviewAgent.review()`` appends this directive
# to every LLM reviewer's system prompt (via ``compose_system_prompt``) to steer
# the model toward emitting the structured tool call as its final action rather
# than prose.  Other Strands ``Agent(...)`` callers (lead engineer, PR info
# collector, orchestrator) keep their own system prompts and are unaffected.
STRUCTURED_OUTPUT_DIRECTIVE = """\
## Output format (mandatory)

Do NOT write a prose or Markdown review report. Do not produce headings, tables, \
summaries, or narrative text as your final answer.

Use tools only to gather the information you need. Once you have gathered enough \
information, your single final action MUST be to return your findings as the \
structured output. Emit the structured output directly; do not restate it as \
prose first. If you have no findings, return an empty structured result rather \
than writing an explanation."""


def compose_system_prompt(system_prompt: str) -> str:
    """Combine a reviewer's role prompt with the shared structured-output directive.

    Output format is a cross-cutting concern shared by every LLM reviewer, so it
    lives here rather than being duplicated into each reviewer's prompt constant.
    """
    return f"{system_prompt}\n\n{STRUCTURED_OUTPUT_DIRECTIVE}"


_HUNK_RE = re.compile(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def _annotate_patch(patch: str) -> str:
    """Annotate each line of a unified diff with its actual file line number.

    Transforms raw unified diff lines into annotated form so the LLM can
    report accurate file-absolute line numbers in its findings:

        @@ -228,3 +224,4 @@       →  @@ -228,3 +224,4 @@
        -old line                  →  -L228:old line
        +new line                  →  +L224:new line
         context                   →   L225:context

    Legend:
      "+L{N}:" — line N added in the new file.
      " L{N}:" — line N unchanged (context) in the new file.
      "-L{N}:" — line N removed from the old file (absent in new file).
    """
    result: list[str] = []
    new_line = 0
    old_line = 0

    for raw in patch.splitlines():
        m = _HUNK_RE.match(raw)
        if m:
            old_line = int(m.group(1))
            new_line = int(m.group(2))
            result.append(raw)
        elif raw.startswith("+"):
            result.append(f"+L{new_line}:{raw[1:]}")
            new_line += 1
        elif raw.startswith("-"):
            result.append(f"-L{old_line}:{raw[1:]}")
            old_line += 1
        elif raw.startswith(" "):
            result.append(f" L{new_line}:{raw[1:]}")
            new_line += 1
            old_line += 1
        else:
            result.append(raw)

    return "\n".join(result)


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
        reviewer_timeout_seconds: Wall-clock timeout in seconds for the full
            concurrent batch of reviewers.  All reviewers start simultaneously,
            so this is effectively a per-reviewer limit.  ``None`` disables the
            timeout (default).  Any reviewer still running when the timeout
            expires is recorded as a :class:`ReviewError` and the others
            continue.  Configurable via ``CODE_REVIEW_REVIEWER_TIMEOUT_SECONDS``.
        mcp_startup_retry_attempts: Maximum GitHub MCP startup attempts
            (including the first), forwarded to
            :func:`~code_review_agent.tools.github_mcp.create_github_mcp_client`.
            Configurable via ``CODE_REVIEW_MCP_STARTUP_RETRY_ATTEMPTS``.
        mcp_startup_retry_backoff_seconds: Base wait time in seconds for the
            startup retry's exponential backoff+jitter, forwarded to
            :func:`~code_review_agent.tools.github_mcp.create_github_mcp_client`.
            Configurable via ``CODE_REVIEW_MCP_STARTUP_RETRY_BACKOFF_SECONDS``.
    """

    github_token: str
    model_id: str = "gpt-4o"
    mcp_url: str = GITHUB_MCP_URL
    llm_base_url: str | None = None
    max_agent_turns: int = 30
    reviewer_timeout_seconds: float | None = None
    mcp_startup_retry_attempts: int = 3
    mcp_startup_retry_backoff_seconds: float = 1.0


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
                params={
                    "temperature": 0.1,
                },
            )
        else:
            model = OpenAIModel(model_id=self._config.model_id)

        tools: list = []
        # In strands >=1.41 ``MCPClient`` is a ``ToolProvider`` whose lifecycle
        # the Agent owns: it calls ``start()`` while loading tools and releases
        # its reference on cleanup.  Opening it ourselves with ``with`` would
        # start the session a second time and raise "the client session is
        # currently running", so we hand the client to the Agent and clean it up
        # deterministically via ``agent.cleanup()`` in ``finally`` -- this also
        # correctly decrements the shared client's reference count instead of
        # stopping it outright when the client is shared across reviewers.
        mcp_client = None
        if self.uses_github_mcp:
            if context.shared_mcp_client is not None:
                # ReviewOrchestrator already started and registered this
                # connection as a consumer of its own; reuse it instead of
                # opening a second connection (spec §4.2/§4.4).
                mcp_client = context.shared_mcp_client
            else:
                mcp_client = create_github_mcp_client(
                    self._config.github_token,
                    self._config.mcp_url,
                    retry_attempts=self._config.mcp_startup_retry_attempts,
                    retry_backoff_seconds=self._config.mcp_startup_retry_backoff_seconds,
                )
            tools.append(mcp_client)

        if self.uses_url_fetch:
            tools.append(http_request)

        plugins: list = []
        if self.skill_type != AgentSkillType.NONE:
            tools.append(file_read)
            plugins.append(create_agent_skills(self.skill_type))

        agent: Agent | None = None
        try:
            agent = Agent(
                model=model,
                system_prompt=compose_system_prompt(self.system_prompt),
                tools=tools,
                plugins=plugins,
            )
            limits: Limits = {"turns": self._config.max_agent_turns}
            result = agent(
                prompt,
                structured_output_model=ReviewOutput,
                limits=limits,
            )
            if result.structured_output is None:
                raise StructuredOutputMissingError(
                    f"Reviewer '{self.reviewer_id}'", result.stop_reason
                )
            output: ReviewOutput = cast(ReviewOutput, result.structured_output)
        finally:
            if agent is not None:
                agent.cleanup()

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
        has_annotated = any(c.patch for c in pr.pr_info.file_changes)
        if has_annotated:
            lines += [
                "Each diff line is prefixed with its actual file line number:",
                "  +L{N}: line N added in the new file",
                "  -L{N}: line N removed from the old file (absent in the new file)",
                "   L{N}: line N unchanged (context) in the new file",
                "When reporting a finding, use the L{N} value as the line number.",
                "",
            ]
        for change in pr.pr_info.file_changes:
            lines.append(f"--- {change.filePath} ---")
            if change.patch:
                lines.append(_annotate_patch(change.patch))
            else:
                lines.append("(patch unavailable; fetch via GitHub)")
        # Known limitation: patches fetched on-demand via GitHub MCP during
        # agent execution are not annotated and may yield inaccurate line numbers.
        lines.append("")
        lines.append(
            "Only the modified sections are provided. Retrieve full files from "
            "GitHub as needed."
        )
        return "\n".join(lines)
