"""Parallel review orchestrator.

Selects the reviewers applicable to a PR (by project type and optional
perspective filter) and runs them concurrently, aggregating their output into
a :class:`ReviewReport`.  This is the parallel review stage of the workflow;
its output is the input to the downstream Lead Engineer synthesis agent.
"""

import asyncio
from collections.abc import Iterable

from ..models.review import (
    ProjectType,
    ReviewContext,
    ReviewError,
    ReviewPerspective,
    ReviewReport,
    ReviewResult,
)
from .base_reviewer import ReviewAgent, ReviewerConfig
from .registry import detect_project_types, get_reviewer_classes


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
        without affecting the others.

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

        # asyncio.wait_for + to_thread blocks until the thread exits on cancellation;
        # asyncio.wait avoids this by letting timed-out threads finish in the background.
        asyncio_tasks = {
            asyncio.create_task(
                asyncio.to_thread(reviewer.review, context, pt),
                name=reviewer.reviewer_id,
            ): (reviewer, pt)
            for reviewer, pt in tasks
        }

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
