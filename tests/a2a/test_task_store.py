import asyncio
import logging
from unittest.mock import AsyncMock, patch

import pytest

from code_review_agent.a2a.models import A2ADataPart, A2ATaskStatus
from code_review_agent.a2a.task_store import TASK_TTL_SECONDS, TaskStore


class TestTaskStoreCreate:
    @pytest.mark.asyncio
    async def test_create_returns_submitted_task(self) -> None:
        store = TaskStore()
        task = await store.create()
        assert task.status == A2ATaskStatus.SUBMITTED
        assert task.id != ""
        assert task.message is None
        assert task.error is None

    @pytest.mark.asyncio
    async def test_create_generates_unique_ids(self) -> None:
        store = TaskStore()
        t1 = await store.create()
        t2 = await store.create()
        assert t1.id != t2.id


class TestTaskStoreGet:
    @pytest.mark.asyncio
    async def test_get_existing_task(self) -> None:
        store = TaskStore()
        task = await store.create()
        found = await store.get(task.id)
        assert found is not None
        assert found.id == task.id

    @pytest.mark.asyncio
    async def test_get_nonexistent_task_returns_none(self) -> None:
        store = TaskStore()
        result = await store.get("nonexistent-id")
        assert result is None


class TestTaskStoreSetWorking:
    @pytest.mark.asyncio
    async def test_set_working_updates_status(self) -> None:
        store = TaskStore()
        task = await store.create()
        await store.set_working(task.id)
        updated = await store.get(task.id)
        assert updated is not None
        assert updated.status == A2ATaskStatus.WORKING

    @pytest.mark.asyncio
    async def test_set_working_on_nonexistent_task_is_noop(self) -> None:
        store = TaskStore()
        await store.set_working("no-such-id")


class TestTaskStoreSetCompleted:
    @pytest.mark.asyncio
    async def test_set_completed_updates_status_and_message(self) -> None:
        store = TaskStore()
        task = await store.create()
        parts = [A2ADataPart(data={"result": "ok"})]
        await store.set_completed(task.id, parts)
        updated = await store.get(task.id)
        assert updated is not None
        assert updated.status == A2ATaskStatus.COMPLETED
        assert updated.message is not None
        assert updated.message.role == "agent"
        assert len(updated.message.parts) == 1

    @pytest.mark.asyncio
    async def test_set_completed_on_nonexistent_task_is_noop(self) -> None:
        store = TaskStore()
        await store.set_completed("no-such-id", [])

    @pytest.mark.asyncio
    async def test_set_completed_on_existing_task_schedules_delete(self) -> None:
        store = TaskStore()
        task = await store.create()
        with patch.object(
            store, "_schedule_delete", new_callable=AsyncMock
        ) as mock_sched:
            await store.set_completed(task.id, [])
            await asyncio.sleep(0)
        mock_sched.assert_called_once_with(task.id)

    @pytest.mark.asyncio
    async def test_set_completed_on_nonexistent_task_does_not_schedule_delete(
        self,
    ) -> None:
        store = TaskStore()
        with patch.object(
            store, "_schedule_delete", new_callable=AsyncMock
        ) as mock_sched:
            await store.set_completed("no-such-id", [])
            await asyncio.sleep(0)
        mock_sched.assert_not_called()


class TestTaskStoreSetFailed:
    @pytest.mark.asyncio
    async def test_set_failed_updates_status_and_error(self) -> None:
        store = TaskStore()
        task = await store.create()
        await store.set_failed(task.id, "something went wrong")
        updated = await store.get(task.id)
        assert updated is not None
        assert updated.status == A2ATaskStatus.FAILED
        assert updated.error == "something went wrong"

    @pytest.mark.asyncio
    async def test_set_failed_on_nonexistent_task_is_noop(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # A truly unknown id records no failure state, so the log must not claim
        # one either -- the WARNING describes the action actually taken, and for a
        # noop there is nothing to report.
        store = TaskStore()
        with caplog.at_level(
            logging.WARNING, logger="code_review_agent.a2a.task_store"
        ):
            await store.set_failed("no-such-id", "error")
        # A noop must emit no log at all -- asserting only that the id is absent
        # would still pass if set_failed logged a WARNING without the id, which
        # would contradict the noop contract. So require zero task_store records.
        task_store_warnings = [
            r for r in caplog.records if r.name == "code_review_agent.a2a.task_store"
        ]
        assert task_store_warnings == []

    @pytest.mark.asyncio
    async def test_set_failed_logs_error(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # The error string carries the reviewer id and stop_reason (from
        # StructuredOutputMissingError). Logging it in set_failed is the single
        # choke point that surfaces every agent failure -- and its stop_reason --
        # in the server log, which the swallow-into-task-store path otherwise hides.
        store = TaskStore()
        task = await store.create()
        error = (
            "Reviewer 'frontend-technical' completed without producing "
            "structured output (stop_reason='limit_turns')."
        )
        with caplog.at_level(
            logging.WARNING, logger="code_review_agent.a2a.task_store"
        ):
            await store.set_failed(task.id, error)
        messages = [r.getMessage() for r in caplog.records]
        assert any(task.id in m and "stop_reason='limit_turns'" in m for m in messages)

    @pytest.mark.asyncio
    async def test_set_failed_logs_multiline_error_as_single_line(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # Non-structured-output failures (e.g. pydantic ValidationError) carry
        # multi-line str(exc). A raw multi-line log entry breaks grep-based
        # failure counting, so the log line is normalized to one line -- while the
        # full error is still stored on the task for the client.
        store = TaskStore()
        task = await store.create()
        error = "validation failed:\nfield a: required\nfield b: too long"
        with caplog.at_level(
            logging.WARNING, logger="code_review_agent.a2a.task_store"
        ):
            await store.set_failed(task.id, error)
        failure_records = [r for r in caplog.records if task.id in r.getMessage()]
        assert failure_records
        assert all("\n" not in r.getMessage() for r in failure_records)
        # The stored error keeps the original multi-line message intact.
        updated = await store.get(task.id)
        assert updated is not None
        assert updated.error == error

    @pytest.mark.asyncio
    async def test_set_failed_on_existing_task_schedules_delete(self) -> None:
        store = TaskStore()
        task = await store.create()
        with patch.object(
            store, "_schedule_delete", new_callable=AsyncMock
        ) as mock_sched:
            await store.set_failed(task.id, "error")
            await asyncio.sleep(0)
        mock_sched.assert_called_once_with(task.id)

    @pytest.mark.asyncio
    async def test_set_failed_on_nonexistent_task_does_not_schedule_delete(
        self,
    ) -> None:
        store = TaskStore()
        with patch.object(
            store, "_schedule_delete", new_callable=AsyncMock
        ) as mock_sched:
            await store.set_failed("no-such-id", "error")
            await asyncio.sleep(0)
        mock_sched.assert_not_called()


class TestTaskStoreTTL:
    def test_ttl_constant(self) -> None:
        assert TASK_TTL_SECONDS == 1800

    @pytest.mark.asyncio
    async def test_task_deleted_after_ttl(self) -> None:
        store = TaskStore()
        task = await store.create()
        with patch("code_review_agent.a2a.task_store.TASK_TTL_SECONDS", 0):
            await store.set_completed(task.id, [])
            await asyncio.sleep(0.05)
        result = await store.get(task.id)
        assert result is None
