"""Tests for the parallel review orchestrator."""

import time
from unittest.mock import patch

from code_review_agent.agents.base_reviewer import ReviewAgent, ReviewerConfig
from code_review_agent.agents.review_orchestrator import ReviewOrchestrator
from code_review_agent.models.pr_info import (
    PRInfo,
    PRInfoResult,
    RepositoryInfo,
)
from code_review_agent.models.review import (
    ProjectType,
    ReviewContext,
    ReviewOutput,
    ReviewPerspective,
    ReviewResult,
)

_MOD = "code_review_agent.agents.review_orchestrator"


def _context() -> ReviewContext:
    return ReviewContext(
        pr_info=PRInfoResult(
            repository_info=RepositoryInfo(owner="o", repository="r"),
            project_summary="s",
            pr_info=PRInfo(title="t", pr_number=1),
        )
    )


class _FakeTechnical(ReviewAgent):
    reviewer_id = "fake-technical"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.REACT_TS})

    def review(self, context, project_type=None):
        time.sleep(0.2)
        return ReviewResult(
            reviewer_id=self.reviewer_id,
            perspective=self.perspective,
            project_type=project_type,
            output=ReviewOutput(summary="tech ok"),
        )


class _FakeSecurity(ReviewAgent):
    reviewer_id = "fake-security"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})

    def review(self, context, project_type=None):
        time.sleep(0.2)
        return ReviewResult(
            reviewer_id=self.reviewer_id,
            perspective=self.perspective,
            project_type=project_type,
            output=ReviewOutput(summary="sec ok"),
        )


class _FailingReviewer(ReviewAgent):
    reviewer_id = "fake-failing"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})

    def review(self, context, project_type=None):
        raise ValueError("boom")


class _SlowReviewer(ReviewAgent):
    reviewer_id = "fake-slow"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.REACT_TS})

    def review(self, context, project_type=None):
        time.sleep(2)  # deliberately longer than the 0.35s test timeout
        return ReviewResult(  # pragma: no cover
            reviewer_id=self.reviewer_id,
            perspective=self.perspective,
            project_type=project_type,
            output=ReviewOutput(summary="slow ok"),
        )


def _orchestrator() -> ReviewOrchestrator:
    return ReviewOrchestrator(ReviewerConfig(github_token="tok"))


class TestRun:
    """run() selects, executes, and aggregates reviewers."""

    def test_aggregates_results(self):
        with patch(
            f"{_MOD}.get_reviewer_classes",
            return_value=[_FakeTechnical, _FakeSecurity],
        ):
            report = _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

        ids = {r.reviewer_id for r in report.results}
        assert ids == {"fake-technical", "fake-security"}
        assert report.errors == []

    def test_records_targeted_project_type(self):
        with patch(f"{_MOD}.get_reviewer_classes", return_value=[_FakeTechnical]):
            report = _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

        assert report.results[0].project_type is ProjectType.REACT_TS

    def test_reviewers_run_in_parallel(self):
        # Two reviewers each sleeping 0.2s should finish well under 0.4s when
        # executed concurrently.
        with patch(
            f"{_MOD}.get_reviewer_classes",
            return_value=[_FakeTechnical, _FakeSecurity],
        ):
            start = time.perf_counter()
            _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)
            elapsed = time.perf_counter() - start

        assert elapsed < 0.35

    def test_error_is_isolated(self):
        with patch(
            f"{_MOD}.get_reviewer_classes",
            return_value=[_FakeTechnical, _FailingReviewer],
        ):
            report = _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

        assert {r.reviewer_id for r in report.results} == {"fake-technical"}
        assert len(report.errors) == 1
        assert report.errors[0].reviewer_id == "fake-failing"
        assert "boom" in report.errors[0].message

    def test_empty_selection_yields_empty_report(self):
        with patch(f"{_MOD}.get_reviewer_classes", return_value=[]):
            report = _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

        assert report.results == []
        assert report.errors == []

    def test_detects_project_type_when_not_given(self):
        with (
            patch(
                f"{_MOD}.detect_project_types",
                return_value={ProjectType.REACT_TS},
            ) as mock_detect,
            patch(
                f"{_MOD}.get_reviewer_classes", return_value=[_FakeTechnical]
            ) as mock_get,
        ):
            report = _orchestrator().run(_context())

        mock_detect.assert_called_once()
        mock_get.assert_called_once()
        assert len(report.results) == 1

    def test_reviewer_run_once_across_multiple_detected_types(self):
        # A reviewer matching two detected types should still run only once.
        calls: list[str] = []

        class _CountingReviewer(ReviewAgent):
            reviewer_id = "counting"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS, ProjectType.NEXTJS})

            def review(self, context, project_type=None):
                calls.append(self.reviewer_id)
                return ReviewResult(
                    reviewer_id=self.reviewer_id,
                    perspective=self.perspective,
                    project_type=project_type,
                    output=ReviewOutput(summary="ok"),
                )

        with (
            patch(
                f"{_MOD}.detect_project_types",
                return_value={ProjectType.REACT_TS, ProjectType.NEXTJS},
            ),
            patch(
                f"{_MOD}.get_reviewer_classes",
                return_value=[_CountingReviewer],
            ),
        ):
            report = _orchestrator().run(_context())

        assert calls == ["counting"]
        assert len(report.results) == 1

    def test_timeout_converts_reviewer_to_error(self):
        # _FakeSecurity sleeps 0.2s, _SlowReviewer sleeps 10s.
        # timeout=0.35 lets _FakeSecurity finish but cuts off _SlowReviewer.
        config = ReviewerConfig(github_token="tok", reviewer_timeout_seconds=0.35)
        orchestrator = ReviewOrchestrator(config)
        with patch(
            f"{_MOD}.get_reviewer_classes",
            return_value=[_SlowReviewer, _FakeSecurity],
        ):
            report = orchestrator.run(_context(), project_type=ProjectType.REACT_TS)

        assert {r.reviewer_id for r in report.results} == {"fake-security"}
        assert len(report.errors) == 1
        assert report.errors[0].reviewer_id == "fake-slow"
        assert "timed out" in report.errors[0].message

    def test_none_timeout_does_not_restrict(self):
        config = ReviewerConfig(github_token="tok", reviewer_timeout_seconds=None)
        orchestrator = ReviewOrchestrator(config)
        with patch(
            f"{_MOD}.get_reviewer_classes",
            return_value=[_FakeTechnical, _FakeSecurity],
        ):
            report = orchestrator.run(_context(), project_type=ProjectType.REACT_TS)

        assert len(report.results) == 2
        assert report.errors == []

    def test_multi_type_annotation_is_deterministic(self):
        # nextjs sorts before react_ts by value, so a reviewer covering both
        # detected types is always annotated with the lowest-sorted type.
        class _MultiReviewer(ReviewAgent):
            reviewer_id = "multi"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS, ProjectType.NEXTJS})

            def review(self, context, project_type=None):
                return ReviewResult(
                    reviewer_id=self.reviewer_id,
                    perspective=self.perspective,
                    project_type=project_type,
                    output=ReviewOutput(summary="ok"),
                )

        with (
            patch(
                f"{_MOD}.detect_project_types",
                return_value={ProjectType.REACT_TS, ProjectType.NEXTJS},
            ),
            patch(
                f"{_MOD}.get_reviewer_classes",
                return_value=[_MultiReviewer],
            ),
        ):
            for _ in range(5):
                report = _orchestrator().run(_context())
                assert report.results[0].project_type is ProjectType.NEXTJS
