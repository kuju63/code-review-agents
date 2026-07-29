"""Shared async test helpers for the A2A reviewer router test suites."""

import asyncio

from code_review_agent.a2a.models import A2ATask, A2ATaskStatus
from code_review_agent.a2a.task_store import TaskStore


async def wait_for_task_completed(
    store: TaskStore,
    task_id: str,
    *,
    deadline: float = 2.0,
    poll_interval: float = 0.02,
) -> A2ATask:
    """Poll ``store`` until ``task_id`` leaves the WORKING/SUBMITTED state.

    The reviewer classes under test are mocked with synchronous, immediate
    return values, so the background task normally completes within a single
    event-loop tick; the deadline only guards against unexpected stalls
    instead of masking them behind a fixed sleep + WORKING-tolerant assert.

    Args:
        store: The task store the background task reports progress to.
        task_id: The id of the task to poll.
        deadline: Maximum number of seconds to poll before giving up.
        poll_interval: Seconds to sleep between polling attempts.

    Returns:
        The task once it reaches a terminal status (COMPLETED or FAILED).

    Raises:
        AssertionError: If the task is missing, or still WORKING/SUBMITTED
            once ``deadline`` has elapsed.
    """
    elapsed = 0.0
    while elapsed < deadline:
        task = await store.get(task_id)
        assert task is not None, f"task {task_id} was evicted before completing"
        if task.status not in (A2ATaskStatus.SUBMITTED, A2ATaskStatus.WORKING):
            return task
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

    task = await store.get(task_id)
    assert task is not None, f"task {task_id} was evicted before completing"
    raise AssertionError(
        f"task {task_id} did not leave {task.status} within {deadline}s"
    )
