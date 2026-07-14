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

        # Two consumers register on the shared client: the orchestrator
        # itself (released immediately once every reviewer task has its own
        # placeholder registered) and a per-task placeholder for the
        # dispatched reviewer (released via add_done_callback once that
        # reviewer's task finishes) -- see run_async's dispatch loop.
        add_consumer_args = [
            c.args[0] for c in shared_client.add_consumer.call_args_list
        ]
        assert shared_client.add_consumer.call_count == 2
        assert orchestrator in add_consumer_args

        shared_client.load_tools.assert_awaited_once()

        remove_consumer_args = [
            c.args[0] for c in shared_client.remove_consumer.call_args_list
        ]
        assert shared_client.remove_consumer.call_count == 2
        assert orchestrator in remove_consumer_args

        # add_consumer(orchestrator) -> load_tools -> remove_consumer(orchestrator)
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
        add_consumer itself) by the time run_async's wait-timeout elapses
        must still be covered by a reference on the shared client, so the
        connection isn't torn down while that reviewer is still
        starting/running (spec §4.6). The fix registers a placeholder
        reference for each dispatched task up front (synchronously, before
        any thread starts) instead of relying on the orchestrator's own
        reference surviving until the reviewer's Agent(...) call registers
        it -- and releases that placeholder only once the task itself is
        genuinely done, via add_done_callback."""
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

            # The reviewer timed out (still blocked). The orchestrator's own
            # setup-time reference may already be released (each dispatched
            # reviewer holds its own placeholder reference from the moment
            # it was dispatched, independent of the orchestrator's) -- but
            # the *reviewer's* own placeholder must not have been released
            # yet, since its thread is still blocked and hasn't finished.
            assert len(report.errors) == 1
            removed = [c.args[0] for c in shared_client.remove_consumer.call_args_list]
            assert removed == [orchestrator]
        finally:
            proceed.set()

        # Let the blocked reviewer finish and give its add_done_callback a
        # chance to run.
        for _ in range(50):
            if shared_client.remove_consumer.call_count >= 2:
                break
            await asyncio.sleep(0.02)

        removed = [c.args[0] for c in shared_client.remove_consumer.call_args_list]
        assert len(removed) == 2
        assert orchestrator in removed

    @pytest.mark.asyncio
    async def test_task_cancellation_does_not_release_placeholder_early(self):
        """Regression test for the precise mechanism in Copilot's follow-up
        comment: cancelling the asyncio.Task wrapping a still-running
        to_thread reviewer marks that Task "done"/"cancelled" almost
        immediately -- independent of whether the underlying OS thread has
        actually finished (asyncio.Future.cancel() succeeds unconditionally;
        concurrent.futures.Future.cancel() only fails silently for
        already-running work). A design that released the placeholder via
        task.add_done_callback(...) would therefore drop the reference while
        the reviewer thread is still genuinely running and possibly still
        using the shared client. The fix instead releases the placeholder
        from *inside* the worker thread itself (see _run_reviewer), which
        this test verifies directly by cancelling the Task ourselves and
        confirming the placeholder survives that cancellation."""
        shared_client = _mock_shared_client()
        proceed = threading.Event()
        thread_finished = threading.Event()

        class _BlockedMCPReviewer(ReviewAgent):
            reviewer_id = "fake-mcp-cancel-target"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            uses_github_mcp = True

            def review(self, context, project_type=None):
                try:
                    proceed.wait(timeout=5)
                    return ReviewResult(
                        reviewer_id=self.reviewer_id,
                        perspective=self.perspective,
                        project_type=project_type,
                        output=ReviewOutput(summary="ok"),
                    )
                finally:
                    thread_finished.set()

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
                await orchestrator.run_async(
                    _context(), project_type=ProjectType.REACT_TS
                )

            # Find and explicitly cancel the still-pending reviewer task,
            # simulating asyncio.run()'s shutdown sequence (or a sibling
            # infra-exception cancellation) -- without yet letting the real
            # thread finish.
            [task] = [
                t
                for t in asyncio.all_tasks()
                if t.get_name() == "fake-mcp-cancel-target"
            ]
            task.cancel()
            await asyncio.sleep(0.05)
            assert task.cancelled() or task.done()
            assert not thread_finished.is_set()

            # The Task is now cancelled/done at the asyncio level, but the
            # real worker thread is still blocked -- the placeholder must
            # not have been released yet.
            removed = [c.args[0] for c in shared_client.remove_consumer.call_args_list]
            assert removed == [orchestrator]
        finally:
            proceed.set()

        for _ in range(50):
            if thread_finished.is_set():
                break
            await asyncio.sleep(0.02)
        assert thread_finished.is_set()

        for _ in range(50):
            if shared_client.remove_consumer.call_count >= 2:
                break
            await asyncio.sleep(0.02)

        removed = [c.args[0] for c in shared_client.remove_consumer.call_args_list]
        assert len(removed) == 2
        assert orchestrator in removed

    def test_shared_client_released_correctly_via_sync_run_wrapper_after_timeout(self):
        """Complements the async regression test above by exercising the
        exact path Copilot's follow-up comment called out: the *synchronous*
        ReviewOrchestrator.run() wrapper (asyncio.run()). asyncio.run()'s
        shutdown sequence calls .cancel() on any reviewer task still pending
        after the timeout -- a no-op for a to_thread task whose underlying
        work has already started running, so run() effectively blocks until
        the reviewer thread genuinely finishes. Both the orchestrator's and
        the reviewer's placeholder references must still end up released
        exactly once each, with no errors."""
        shared_client = _mock_shared_client()

        class _BrieflySlowMCPReviewer(ReviewAgent):
            reviewer_id = "fake-mcp-briefly-slow"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            uses_github_mcp = True

            def review(self, context, project_type=None):
                time.sleep(0.1)  # longer than reviewer_timeout_seconds below
                return ReviewResult(
                    reviewer_id=self.reviewer_id,
                    perspective=self.perspective,
                    project_type=project_type,
                    output=ReviewOutput(summary="ok"),
                )

        config = ReviewerConfig(github_token="tok", reviewer_timeout_seconds=0.02)
        orchestrator = ReviewOrchestrator(config)
        with (
            patch(
                f"{_MOD}.get_reviewer_classes",
                return_value=[_BrieflySlowMCPReviewer],
            ),
            patch(f"{_MOD}.create_github_mcp_client", return_value=shared_client),
        ):
            report = orchestrator.run(_context(), project_type=ProjectType.REACT_TS)

        assert len(report.errors) == 1
        removed = [c.args[0] for c in shared_client.remove_consumer.call_args_list]
        assert len(removed) == 2
        assert orchestrator in removed
