"""Tests for the parallel review orchestrator."""

import asyncio
import threading
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ConnectError
from strands.types.exceptions import (
    EventLoopException,
    MCPClientInitializationError,
    ToolProviderException,
)

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


class _EventLoopFailingReviewer(ReviewAgent):
    reviewer_id = "fake-event-loop-failing"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})

    def review(self, context, project_type=None):
        raise EventLoopException(ConnectError("model connection lost"))


class _MCPInitFailingReviewer(ReviewAgent):
    reviewer_id = "fake-mcp-init-failing"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})

    def review(self, context, project_type=None):
        raise MCPClientInitializationError("the client initialization failed")


class _TransportFailingReviewer(ReviewAgent):
    reviewer_id = "fake-transport-failing"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})

    def review(self, context, project_type=None):
        raise ConnectError("connection reset")


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


class _MCPUsingFakeReviewer(ReviewAgent):
    """Fake reviewer that declares GitHub MCP usage and records the context
    it was called with, so tests can assert on what the orchestrator injects."""

    reviewer_id = "fake-mcp-using"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.REACT_TS})
    uses_github_mcp = True

    received_contexts: list[ReviewContext] = []

    def review(self, context, project_type=None):
        self.received_contexts.append(context)
        return ReviewResult(
            reviewer_id=self.reviewer_id,
            perspective=self.perspective,
            project_type=project_type,
            output=ReviewOutput(summary="mcp ok"),
        )


class _MCPUsingFakeSecurityReviewer(ReviewAgent):
    """A second, distinct GitHub-MCP-using reviewer class -- distinct from
    _MCPUsingFakeReviewer so _select_reviewers instantiates two reviewers
    instead of deduplicating by class."""

    reviewer_id = "fake-mcp-using-security"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})
    uses_github_mcp = True

    def review(self, context, project_type=None):
        return ReviewResult(
            reviewer_id=self.reviewer_id,
            perspective=self.perspective,
            project_type=project_type,
            output=ReviewOutput(summary="mcp sec ok"),
        )


def _mock_shared_client() -> MagicMock:
    client = MagicMock()
    client.load_tools = AsyncMock()
    return client


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

    def test_event_loop_exception_propagates_instead_of_being_swallowed(self):
        with patch(
            f"{_MOD}.get_reviewer_classes",
            return_value=[_FakeTechnical, _EventLoopFailingReviewer],
        ):
            with pytest.raises(EventLoopException):
                _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

    def test_mcp_init_exception_propagates_instead_of_being_swallowed(self):
        with patch(
            f"{_MOD}.get_reviewer_classes",
            return_value=[_FakeTechnical, _MCPInitFailingReviewer],
        ):
            with pytest.raises(MCPClientInitializationError):
                _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

    def test_transport_exception_propagates_instead_of_being_swallowed(self):
        with patch(
            f"{_MOD}.get_reviewer_classes",
            return_value=[_FakeTechnical, _TransportFailingReviewer],
        ):
            with pytest.raises(ConnectError):
                _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

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


class TestSharedMcpClient:
    """The orchestrator creates and manages one shared GitHub MCP client for
    the parallel review stage per spec §4.1/§4.4/§4.5."""

    def setup_method(self):
        _MCPUsingFakeReviewer.received_contexts.clear()

    def test_shared_mcp_client_created_once_when_reviewers_use_mcp(self):
        shared_client = _mock_shared_client()
        with (
            patch(
                f"{_MOD}.get_reviewer_classes",
                return_value=[_MCPUsingFakeReviewer, _MCPUsingFakeSecurityReviewer],
            ),
            patch(
                f"{_MOD}.create_github_mcp_client", return_value=shared_client
            ) as mock_factory,
        ):
            report = _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

        mock_factory.assert_called_once()
        assert {r.reviewer_id for r in report.results} == {
            "fake-mcp-using",
            "fake-mcp-using-security",
        }

    def test_shared_mcp_client_not_created_when_no_reviewer_uses_mcp(self):
        with (
            patch(
                f"{_MOD}.get_reviewer_classes",
                return_value=[_FakeTechnical, _FakeSecurity],
            ),
            patch(f"{_MOD}.create_github_mcp_client") as mock_factory,
        ):
            _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

        mock_factory.assert_not_called()

    def test_orchestrator_registers_and_releases_consumer(self):
        shared_client = _mock_shared_client()
        orchestrator = _orchestrator()
        with (
            patch(
                f"{_MOD}.get_reviewer_classes",
                return_value=[_MCPUsingFakeReviewer],
            ),
            patch(f"{_MOD}.create_github_mcp_client", return_value=shared_client),
        ):
            orchestrator.run(_context(), project_type=ProjectType.REACT_TS)

        shared_client.add_consumer.assert_called_once_with(orchestrator)
        shared_client.load_tools.assert_awaited_once()
        shared_client.remove_consumer.assert_called_once_with(orchestrator)

        # add_consumer -> load_tools -> remove_consumer, in that order.
        call_names = [c[0] for c in shared_client.mock_calls]
        assert call_names.index("add_consumer") < call_names.index("load_tools")
        assert call_names.index("load_tools") < call_names.index("remove_consumer")

    def test_shared_client_injected_into_context(self):
        shared_client = _mock_shared_client()
        with (
            patch(
                f"{_MOD}.get_reviewer_classes",
                return_value=[_MCPUsingFakeReviewer],
            ),
            patch(f"{_MOD}.create_github_mcp_client", return_value=shared_client),
        ):
            _orchestrator().run(_context(), project_type=ProjectType.REACT_TS)

        assert len(_MCPUsingFakeReviewer.received_contexts) == 1
        assert (
            _MCPUsingFakeReviewer.received_contexts[0].shared_mcp_client
            is shared_client
        )

    def test_shared_client_startup_failure_removes_consumer_and_reraises(self):
        shared_client = _mock_shared_client()
        shared_client.load_tools.side_effect = ToolProviderException("failed to start")
        orchestrator = _orchestrator()
        with (
            patch(
                f"{_MOD}.get_reviewer_classes",
                return_value=[_MCPUsingFakeReviewer],
            ),
            patch(f"{_MOD}.create_github_mcp_client", return_value=shared_client),
        ):
            with pytest.raises(ToolProviderException):
                orchestrator.run(_context(), project_type=ProjectType.REACT_TS)

        shared_client.remove_consumer.assert_called_once_with(orchestrator)

    @pytest.mark.asyncio
    async def test_shared_client_not_released_until_pending_reviewer_finishes(self):
        """Regression test for a race flagged in PR review: a reviewer whose
        background thread hasn't reached Agent(...) (and thus hasn't called
        add_consumer) by the time run_async's wait-timeout elapses must not
        see the shared connection torn down by the orchestrator's own
        release, which used to fire unconditionally as soon as the timeout
        window closed (spec §4.6)."""
        shared_client = _mock_shared_client()
        proceed = threading.Event()

        class _BlockedMCPReviewer(ReviewAgent):
            reviewer_id = "fake-mcp-blocked"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            uses_github_mcp = True

            def review(self, context, project_type=None):
                # Runs in a worker thread; simulates a reviewer whose
                # Agent(...)/add_consumer call hasn't happened yet by the
                # time the orchestrator's wait times out.
                proceed.wait(timeout=5)
                return ReviewResult(
                    reviewer_id=self.reviewer_id,
                    perspective=self.perspective,
                    project_type=project_type,
                    output=ReviewOutput(summary="ok"),
                )

        config = ReviewerConfig(github_token="tok", reviewer_timeout_seconds=0.05)
        orchestrator = ReviewOrchestrator(config)
        try:
            with (
                patch(
                    f"{_MOD}.get_reviewer_classes",
                    return_value=[_BlockedMCPReviewer],
                ),
                patch(f"{_MOD}.create_github_mcp_client", return_value=shared_client),
            ):
                report = await orchestrator.run_async(
                    _context(), project_type=ProjectType.REACT_TS
                )

            # The reviewer timed out (still blocked) -- but the shared
            # client's reference must not have been released yet, since the
            # blocked reviewer thread hasn't finished (and thus hasn't had a
            # chance to register/release its own reference).
            assert len(report.errors) == 1
            shared_client.remove_consumer.assert_not_called()
        finally:
            proceed.set()

        # Let the blocked reviewer finish and give the background release
        # task a chance to run.
        for _ in range(50):
            if shared_client.remove_consumer.called:
                break
            await asyncio.sleep(0.02)

        shared_client.remove_consumer.assert_called_once_with(orchestrator)
