import asyncio
import logging
from uuid import uuid4

from .models import A2AMessage, A2ATask, A2ATaskStatus

TASK_TTL_SECONDS = 1800

logger = logging.getLogger(__name__)


class TaskStore:
    def __init__(self) -> None:
        self._store: dict[str, A2ATask] = {}
        self._lock = asyncio.Lock()

    async def _schedule_delete(self, task_id: str) -> None:
        await asyncio.sleep(TASK_TTL_SECONDS)
        async with self._lock:
            self._store.pop(task_id, None)

    async def create(self) -> A2ATask:
        task = A2ATask(id=str(uuid4()), status=A2ATaskStatus.SUBMITTED)
        async with self._lock:
            self._store[task.id] = task
        return task

    async def get(self, task_id: str) -> A2ATask | None:
        async with self._lock:
            return self._store.get(task_id)

    async def set_working(self, task_id: str) -> None:
        async with self._lock:
            if task := self._store.get(task_id):
                self._store[task_id] = task.model_copy(
                    update={"status": A2ATaskStatus.WORKING}
                )

    async def set_completed(self, task_id: str, parts: list) -> None:
        async with self._lock:
            task = self._store.get(task_id)
            if task is not None:
                self._store[task_id] = task.model_copy(
                    update={
                        "status": A2ATaskStatus.COMPLETED,
                        "message": A2AMessage(role="agent", parts=parts),
                    }
                )
        # Only schedule TTL deletion for a task that actually exists; otherwise
        # an unknown id would spawn a background task that sleeps for the full
        # TTL and then pops nothing.  Scheduled outside the lock to avoid
        # holding it across task creation.
        if task is not None:
            asyncio.create_task(self._schedule_delete(task_id))

    async def set_failed(self, task_id: str, error: str) -> None:
        # Every agent failure funnels through here, but the endpoints only store
        # the (already sanitized) error on the task -- they log nothing. That hid
        # StructuredOutputMissingError's stop_reason from the server log, forcing
        # failures to be reconstructed after the fact. Logging the sanitized
        # string surfaces the reviewer id and stop_reason without leaking tokens.
        logger.warning("Task %s failed: %s", task_id, error)
        async with self._lock:
            task = self._store.get(task_id)
            if task is not None:
                self._store[task_id] = task.model_copy(
                    update={"status": A2ATaskStatus.FAILED, "error": error}
                )
        if task is not None:
            asyncio.create_task(self._schedule_delete(task_id))
