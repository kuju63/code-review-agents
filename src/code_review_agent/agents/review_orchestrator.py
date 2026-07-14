"""Parallel review orchestrator.

Selects the reviewers applicable to a PR (by project type and optional
perspective filter) and runs them concurrently, aggregating their output into
a :class:`ReviewReport`.  This is the parallel review stage of the workflow;
its output is the input to the downstream Lead Engineer synthesis agent.
"""

import asyncio
from collections.abc import Iterable

from strands.tools.mcp import MCPClient

from ..models.review import (
    ProjectType,
    ReviewContext,
    ReviewError,
    ReviewPerspective,
    ReviewReport,
    ReviewResult,
)
from ..tools.github_mcp import create_github_mcp_client
from .base_reviewer import ReviewAgent, ReviewerConfig
from .exceptions import INFRA_EXCEPTIONS
from .registry import detect_project_types, get_reviewer_classes


def _run_reviewer(
    reviewer: ReviewAgent,
    context: ReviewContext,
    project_type: ProjectType,
    shared_client: MCPClient | None,
    placeholder: object | None,
) -> ReviewResult:
    """Run ``reviewer.review(...)`` and release its shared-client placeholder
    reference from *inside* the worker thread this runs on (via
    :func:`asyncio.to_thread`), in a ``finally`` block.

    This ties the placeholder's release to the actual completion of
    ``reviewer.review(...)`` rather than to the wrapping ``asyncio.Task``'s
    own state. Cancelling that Task (e.g. ``asyncio.run()``'s shutdown
    sequence, or a re-raised infra exception cancelling siblings) does not
    stop the already-running worker thread, but it *does* mark the Task
    itself "cancelled" and fire its done-callbacks almost immediately --
    well before the thread genuinely finishes. Releasing via a callback
    keyed to the Task's completion would therefore drop the reference (and
    risk the shared connection being stopped) while the reviewer is still
    actively using it.
    """
    try:
        return reviewer.review(context, project_type)
    finally:
        if shared_client is not None and placeholder is not None:
            shared_client.remove_consumer(placeholder)


class ReviewOrchestrator:
    """Runs applicable reviewers concurrently and aggregates their results.

    Args:
        config: Shared configuration injected into every selected reviewer.
    """

    def __init__(self, config: ReviewerConfig) -> None:
        self._config = config

    def run(
        self,
        context: ReviewContext,
        project_type: ProjectType | None = None,
        perspectives: Iterable[ReviewPerspective] | None = None,
    ) -> ReviewReport:
        """Run the parallel review stage synchronously.

        Convenience wrapper around :meth:`run_async` for callers that are not
        already inside an event loop.

        Args:
            context: Input boundary wrapping the collected PR information.
            project_type: Explicit project type; when ``None`` it is inferred
                from the PR information.
            perspectives: Optional perspectives to restrict the review to.

        Returns:
            The aggregated report of successful results and isolated errors.
        """
        return asyncio.run(self.run_async(context, project_type, perspectives))

    async def run_async(
        self,
        context: ReviewContext,
        project_type: ProjectType | None = None,
        perspectives: Iterable[ReviewPerspective] | None = None,
    ) -> ReviewReport:
        """Run the parallel review stage concurrently.

        Each reviewer's synchronous :meth:`~ReviewAgent.review` is offloaded to
        a worker thread via :func:`asyncio.to_thread`, so the GitHub MCP
        context manager stays isolated per reviewer while still running in
        parallel.  A failing reviewer is recorded as a :class:`ReviewError`
        without affecting the others, except for :data:`INFRA_EXCEPTIONS`
        (model connection loss, MCP client init failure, transport timeouts),
        which are re-raised instead of being degraded to a business error.

        Args:
            context: Input boundary wrapping the collected PR information.
            project_type: Explicit project type; when ``None`` it is inferred
                from the PR information.
            perspectives: Optional perspectives to restrict the review to.

        Returns:
            The aggregated report of successful results and isolated errors.
        """
        tasks = self._select_reviewers(context, project_type, perspectives)
        if not tasks:
            return ReviewReport()

        timeout = self._config.reviewer_timeout_seconds

        # Open one shared GitHub MCP connection for the whole parallel-review
        # batch when at least one selected reviewer uses it, instead of each
        # reviewer opening its own -- this is the fix for the startup
        # congestion in Issue #115 (spec §4.1/§4.4). Only start()-equivalent
        # (load_tools(), the ToolProvider entry point) is used here; calling
        # the low-level start() directly would leave the client's internal
        # "started" state out of sync with what each reviewer's Agent later
        # observes (spec §3.1).
        shared_client = None
        if any(getattr(reviewer, "uses_github_mcp", False) for reviewer, _ in tasks):
            shared_client = create_github_mcp_client(
                self._config.github_token,
                self._config.mcp_url,
                retry_attempts=self._config.mcp_startup_retry_attempts,
                retry_backoff_seconds=self._config.mcp_startup_retry_backoff_seconds,
            )
            shared_client.add_consumer(self)
            try:
                await shared_client.load_tools()
            except BaseException:
                # BaseException, not Exception: asyncio.CancelledError is a
                # BaseException subclass (not an Exception subclass), so a
                # cancellation delivered while suspended on this await would
                # otherwise bypass an `except Exception:` clause entirely,
                # permanently leaking the orchestrator's reference -- the
                # shared client's refcount would then never reach zero and
                # the connection would never be stopped.
                shared_client.remove_consumer(self)
                raise
            context = context.model_copy(update={"shared_mcp_client": shared_client})

        # asyncio.wait_for + to_thread blocks until the thread exits on
        # cancellation; asyncio.wait avoids this by letting timed-out
        # threads finish in the background.
        asyncio_tasks: dict[asyncio.Task, tuple[ReviewAgent, ProjectType]] = {}
        try:
            for reviewer, pt in tasks:
                placeholder: object | None = None
                if shared_client is not None and getattr(
                    reviewer, "uses_github_mcp", False
                ):
                    # Register a placeholder reference for this specific
                    # reviewer synchronously, before its worker thread even
                    # starts -- rather than relying on the orchestrator's own
                    # reference until the `asyncio.wait` timeout below
                    # elapses. This closes the race Copilot flagged: a
                    # reviewer thread that hasn't reached its own
                    # Agent(...)/add_consumer call yet is already covered by
                    # its own placeholder, so releasing the orchestrator's
                    # reference right after this loop can never drop the
                    # connection's reference count to zero while any
                    # dispatched reviewer task is still outstanding (spec
                    # §4.6). The placeholder is released from *inside* the
                    # worker thread (see `_run_reviewer`), not via an
                    # `asyncio.Task` done-callback: cancelling the Task
                    # (e.g. asyncio.run()'s shutdown, or a re-raised infra
                    # exception) marks it "cancelled" and fires its
                    # callbacks almost immediately, without actually
                    # stopping the underlying thread -- a done-callback
                    # would therefore risk releasing the reference while the
                    # reviewer is still running.
                    placeholder = object()
                    shared_client.add_consumer(placeholder)
                task = asyncio.create_task(
                    asyncio.to_thread(
                        _run_reviewer, reviewer, context, pt, shared_client, placeholder
                    ),
                    name=reviewer.reviewer_id,
                )
                asyncio_tasks[task] = (reviewer, pt)
        finally:
            if shared_client is not None:
                # Every dispatched reviewer already holds its own
                # placeholder reference (registered above); the
                # orchestrator's setup-time reference is now redundant. A
                # `finally` (rather than a plain statement after the loop)
                # also releases it if dispatch itself is interrupted
                # partway through.
                shared_client.remove_consumer(self)

        _, pending = await asyncio.wait(
            asyncio_tasks.keys(),
            timeout=timeout,  # None means wait indefinitely
        )

        results: list[ReviewResult] = []
        errors: list[ReviewError] = []
        for asyncio_task, (reviewer, _) in asyncio_tasks.items():
            if asyncio_task in pending:
                errors.append(
                    ReviewError(
                        reviewer_id=reviewer.reviewer_id,
                        perspective=reviewer.perspective,
                        message=f"Reviewer timed out after {timeout}s",
                    )
                )
            elif exc := asyncio_task.exception():
                if isinstance(exc, INFRA_EXCEPTIONS):
                    raise exc
                errors.append(
                    ReviewError(
                        reviewer_id=reviewer.reviewer_id,
                        perspective=reviewer.perspective,
                        message=str(exc),
                    )
                )
            else:
                results.append(asyncio_task.result())
        return ReviewReport(results=results, errors=errors)

    def _select_reviewers(
        self,
        context: ReviewContext,
        project_type: ProjectType | None,
        perspectives: Iterable[ReviewPerspective] | None,
    ) -> list[tuple[ReviewAgent, ProjectType]]:
        """Resolve which reviewers to run and the project type each targets.

        A reviewer that applies to several detected project types is run only
        once, labelled with the first matching type in a deterministic order
        (project types are sorted by value so the annotation is stable across
        runs).

        Args:
            context: Input boundary wrapping the collected PR information.
            project_type: Explicit project type, or ``None`` to infer it.
            perspectives: Optional perspectives to restrict the selection to.

        Returns:
            Instantiated reviewers paired with the project type they target.
        """
        if project_type is not None:
            project_types: set[ProjectType] = {project_type}
        else:
            project_types = detect_project_types(context.pr_info)

        targeted: dict[type[ReviewAgent], ProjectType] = {}
        for pt in sorted(project_types, key=lambda p: p.value):
            for cls in get_reviewer_classes(pt, perspectives):
                targeted.setdefault(cls, pt)

        return [(cls(self._config), pt) for cls, pt in targeted.items()]
