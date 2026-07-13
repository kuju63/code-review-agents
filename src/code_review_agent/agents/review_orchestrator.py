"""Parallel review orchestrator.

Selects the reviewers applicable to a PR (by project type and optional
perspective filter) and runs them concurrently, aggregating their output into
a :class:`ReviewReport`.  This is the parallel review stage of the workflow;
its output is the input to the downstream Lead Engineer synthesis agent.
"""

import asyncio
from collections.abc import Coroutine, Iterable
from typing import Any

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

# asyncio only holds a *weak* reference to a Task; without a strong reference
# held elsewhere, a fire-and-forget task (see ``_schedule_background``) could
# be garbage-collected mid-execution. This module-level set is that reference,
# per the pattern documented for ``asyncio.create_task``.
_background_tasks: set[asyncio.Task] = set()


def _schedule_background(coro: Coroutine[Any, Any, None]) -> None:
    """Run ``coro`` in the background without awaiting it, safely.

    Keeps a strong reference to the created task until it finishes (see
    module docstring on ``_background_tasks``).
    """
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _release_after_reviewers(
    shared_client: MCPClient,
    consumer: object,
    reviewer_tasks: list[asyncio.Task],
) -> None:
    """Release ``consumer``'s reference on ``shared_client`` only once every
    task in ``reviewer_tasks`` has finished -- including ones still running
    past ``run_async``'s own wait-timeout window.

    A reviewer's background thread only registers itself as a consumer once
    its ``Agent(...)`` construction reaches that point. Releasing the
    orchestrator's own reference as soon as the wait-timeout elapses (rather
    than once every spawned task is actually done) could otherwise drop the
    reference count to zero -- stopping the shared connection -- before a
    slow-to-start reviewer thread had a chance to register at all (spec
    §4.6). ``try/finally`` guarantees the release still happens even if this
    task itself is cancelled, e.g. by ``asyncio.run()``'s shutdown sequence
    when ``ReviewOrchestrator.run`` is used instead of ``run_async``.
    """
    try:
        await asyncio.gather(*reviewer_tasks, return_exceptions=True)
    finally:
        shared_client.remove_consumer(consumer)


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
            except Exception:
                shared_client.remove_consumer(self)
                raise
            context = context.model_copy(update={"shared_mcp_client": shared_client})

        # asyncio.wait_for + to_thread blocks until the thread exits on
        # cancellation; asyncio.wait avoids this by letting timed-out
        # threads finish in the background.
        asyncio_tasks = {
            asyncio.create_task(
                asyncio.to_thread(reviewer.review, context, pt),
                name=reviewer.reviewer_id,
            ): (reviewer, pt)
            for reviewer, pt in tasks
        }

        if shared_client is not None:
            # Deferred to a background task rather than a `finally` tied to
            # the `asyncio.wait` below: see `_release_after_reviewers`.
            _schedule_background(
                _release_after_reviewers(
                    shared_client, self, list(asyncio_tasks.keys())
                )
            )

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
