"""Tests for review result models."""

from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError
from strands.tools.mcp import MCPClient

from code_review_agent.models.pr_info import (
    PRInfo,
    PRInfoResult,
    RepositoryInfo,
)
from code_review_agent.models.review import (
    ProjectType,
    ReviewContext,
    ReviewError,
    ReviewFinding,
    ReviewOutput,
    ReviewPerspective,
    ReviewPriority,
    ReviewReport,
    ReviewResult,
)


def _make_pr_info() -> PRInfoResult:
    return PRInfoResult(
        repository_info=RepositoryInfo(owner="octocat", repository="hello"),
        project_summary="A sample project.",
        pr_info=PRInfo(title="Fix", pr_number=1),
        dependency_files=["package.json"],
    )


class TestEnums:
    """Tests for the extension-axis enumerations."""

    def test_project_type_values(self):
        assert ProjectType.REACT_TS.value == "react_ts"
        assert ProjectType.ANGULAR.value == "angular"
        # Future project types must be declared even if not yet registered.
        for name in ("SPRING_BOOT", "NEXTJS", "NUXT", "WASM"):
            assert hasattr(ProjectType, name)

    def test_review_perspective_values(self):
        assert ReviewPerspective.TECHNICAL.value == "technical"
        assert ReviewPerspective.SECURITY.value == "security"
        # Future perspectives must be declared even if not yet registered.
        for name in ("SPEC_CONSISTENCY", "REQUIREMENTS_CONSISTENCY"):
            assert hasattr(ReviewPerspective, name)

    def test_review_priority_values(self):
        assert {p.value for p in ReviewPriority} == {
            "critical",
            "high",
            "medium",
            "low",
        }

    def test_enums_are_string_compatible(self):
        # StrEnum members compare equal to their string value.
        assert ProjectType.REACT_TS == "react_ts"
        assert ReviewPerspective.SECURITY == "security"


class TestReviewFinding:
    """Tests for the ReviewFinding model."""

    def test_minimal_finding(self):
        finding = ReviewFinding(
            comment="Avoid index as key", priority=ReviewPriority.MEDIUM
        )
        assert finding.comment == "Avoid index as key"
        assert finding.priority is ReviewPriority.MEDIUM
        assert finding.file_path is None
        assert finding.line is None
        assert finding.context is None
        assert finding.proposed_fix is None

    def test_full_finding(self):
        finding = ReviewFinding(
            file_path="src/App.tsx",
            line=42,
            comment="useEffect missing dependency",
            context="Stale closure risk",
            proposed_fix="Add `count` to the dependency array",
            priority=ReviewPriority.HIGH,
        )
        assert finding.file_path == "src/App.tsx"
        assert finding.line == 42
        assert finding.priority is ReviewPriority.HIGH

    def test_priority_is_required(self):
        with pytest.raises(ValidationError):
            ReviewFinding.model_validate({"comment": "missing priority"})

    def test_priority_accepts_string_value(self):
        # StrEnum coerces the raw value during validation.
        finding = ReviewFinding.model_validate({"comment": "x", "priority": "high"})
        assert finding.priority is ReviewPriority.HIGH


class TestReviewOutput:
    """Tests for the LLM-facing ReviewOutput model."""

    def test_defaults_to_empty_findings(self):
        output = ReviewOutput(summary="No issues found.")
        assert output.findings == []

    def test_holds_findings(self):
        output = ReviewOutput(
            summary="One issue.",
            findings=[ReviewFinding(comment="x", priority=ReviewPriority.LOW)],
        )
        assert len(output.findings) == 1


class TestReviewContext:
    """Tests for the ReviewContext input boundary."""

    def test_wraps_pr_info(self):
        ctx = ReviewContext(pr_info=_make_pr_info())
        assert ctx.pr_info.repository_info.owner == "octocat"

    def test_shared_mcp_client_defaults_to_none(self):
        ctx = ReviewContext(pr_info=_make_pr_info())
        assert ctx.shared_mcp_client is None

    def test_accepts_shared_mcp_client(self):
        # arbitrary_types_allowed still isinstance-checks the field, so the
        # double must satisfy isinstance(_, MCPClient), not just any object().
        mock_client = MagicMock(spec=MCPClient)
        ctx = ReviewContext(pr_info=_make_pr_info(), shared_mcp_client=mock_client)
        assert ctx.shared_mcp_client is mock_client


class TestReviewResult:
    """Tests for the ReviewResult metadata wrapper."""

    def test_carries_metadata_and_output(self):
        result = ReviewResult(
            reviewer_id="frontend-technical",
            perspective=ReviewPerspective.TECHNICAL,
            project_type=ProjectType.REACT_TS,
            output=ReviewOutput(summary="ok"),
        )
        assert result.reviewer_id == "frontend-technical"
        assert result.perspective is ReviewPerspective.TECHNICAL
        assert result.project_type is ProjectType.REACT_TS

    def test_project_type_optional(self):
        result = ReviewResult(
            reviewer_id="r",
            perspective=ReviewPerspective.SECURITY,
            output=ReviewOutput(summary="ok"),
        )
        assert result.project_type is None


class TestReviewReport:
    """Tests for the aggregated ReviewReport output."""

    def test_defaults_empty(self):
        report = ReviewReport()
        assert report.results == []
        assert report.errors == []

    def test_aggregates_results_and_errors(self):
        report = ReviewReport(
            results=[
                ReviewResult(
                    reviewer_id="r",
                    perspective=ReviewPerspective.TECHNICAL,
                    output=ReviewOutput(summary="ok"),
                )
            ],
            errors=[
                ReviewError(
                    reviewer_id="bad",
                    perspective=ReviewPerspective.SECURITY,
                    message="boom",
                )
            ],
        )
        assert len(report.results) == 1
        assert len(report.errors) == 1
        assert report.errors[0].message == "boom"
