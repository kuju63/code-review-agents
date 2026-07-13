"""Pydantic models for the parallel review stage.

Defines the two extension axes (project type and review perspective) and the
result schemas shared by every reviewer.  Keeping these models separate from
the concrete reviewers lets new project types and perspectives reuse the same
output contract without changing orchestration.
"""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field
from strands.tools.mcp import MCPClient

from .pr_info import PRInfoResult


class ProjectType(StrEnum):
    """Project technology stack a reviewer applies to.

    Only :attr:`REACT_TS` is wired up today; the remaining members are declared
    so future reviewers and project-type detection can reference them without a
    schema change.
    """

    REACT_TS = "react_ts"
    SPRING_BOOT = "spring_boot"
    NEXTJS = "nextjs"
    NUXT = "nuxt"
    WASM = "wasm"


class ReviewPerspective(StrEnum):
    """The lens a reviewer evaluates a change through.

    :attr:`TECHNICAL` and :attr:`SECURITY` are implemented; the consistency
    perspectives are declared for future reviewers that will also consume spec
    or requirement inputs via :class:`ReviewContext`.
    """

    TECHNICAL = "technical"
    SECURITY = "security"
    SPEC_CONSISTENCY = "spec_consistency"
    REQUIREMENTS_CONSISTENCY = "requirements_consistency"


class ReviewPriority(StrEnum):
    """Severity/priority assigned to an individual finding."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReviewFinding(BaseModel):
    """A single issue raised by a reviewer.

    Attributes:
        file_path: Target file path, if the finding is location-specific.
        line: Target line number, if known.
        comment: The concrete review comment describing the issue.
        context: Why the issue matters (rationale/impact).
        proposed_fix: Suggested fix, when the reviewer can offer one.
        priority: Implementation priority/severity of the finding.
    """

    file_path: str | None = Field(default=None, description="Target file path")
    line: int | None = Field(default=None, description="Target line number")
    comment: str = Field(..., description="Review comment describing the issue")
    context: str | None = Field(
        default=None, description="Why the issue matters (rationale/impact)"
    )
    proposed_fix: str | None = Field(default=None, description="Suggested fix")
    priority: ReviewPriority = Field(..., description="Priority/severity")


class ReviewOutput(BaseModel):
    """The free-form review payload an LLM reviewer produces.

    This is the schema passed to ``Agent.structured_output``; it intentionally
    excludes reviewer metadata, which the reviewer attaches afterwards in
    :class:`ReviewResult`.

    Attributes:
        summary: Short overall summary of the review.
        findings: Individual findings raised by the reviewer.
    """

    summary: str = Field(..., description="Overall summary of the review")
    findings: list[ReviewFinding] = Field(
        default_factory=list, description="Individual findings"
    )


class ReviewContext(BaseModel):
    """Input passed to every reviewer.

    Wraps the PR Info Collector output.  Additional inputs needed by future
    perspectives (e.g. ``spec_documents`` for spec-consistency review) can be
    added here without changing the ``review(context)`` signature.

    Attributes:
        pr_info: Structured PR information from the PR Info Collector.
        shared_mcp_client: Shared GitHub MCP client injected by
            :class:`~code_review_agent.agents.review_orchestrator.ReviewOrchestrator`
            for the parallel review stage.  ``None`` when unused, in which case
            reviewers fall back to creating their own client.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    pr_info: PRInfoResult = Field(..., description="Collected PR information")
    shared_mcp_client: MCPClient | None = Field(
        default=None,
        exclude=True,
        repr=False,
        description="Shared GitHub MCP client for the parallel review stage",
    )


class ReviewResult(BaseModel):
    """A reviewer's output annotated with its identity and scope.

    Attributes:
        reviewer_id: Stable identifier of the reviewer that produced this.
        perspective: The review perspective applied.
        project_type: The project type this review targeted, if applicable.
        output: The review payload (summary and findings).
    """

    reviewer_id: str = Field(..., description="Identifier of the reviewer")
    perspective: ReviewPerspective = Field(..., description="Review perspective")
    project_type: ProjectType | None = Field(
        default=None, description="Targeted project type"
    )
    output: ReviewOutput = Field(..., description="Review payload")


class ReviewError(BaseModel):
    """Record of a reviewer that failed, kept isolated from successes.

    Attributes:
        reviewer_id: Identifier of the reviewer that failed.
        perspective: The perspective the failed reviewer covered.
        message: Human-readable error description.
    """

    reviewer_id: str = Field(..., description="Identifier of the reviewer")
    perspective: ReviewPerspective = Field(..., description="Review perspective")
    message: str = Field(..., description="Error description")


class ReviewReport(BaseModel):
    """Aggregated output of the parallel review stage.

    This is the hand-off to the downstream Lead Engineer synthesis agent.

    Attributes:
        results: Successful reviewer results.
        errors: Reviewers that failed, isolated so one failure does not drop
            the others.
    """

    results: list[ReviewResult] = Field(
        default_factory=list, description="Successful reviewer results"
    )
    errors: list[ReviewError] = Field(
        default_factory=list, description="Failed reviewers"
    )
