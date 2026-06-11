import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from code_review_agent.a2a.models import A2ATaskStatus
from code_review_agent.a2a.task_store import TaskStore
from code_review_agent.api.agents.common import verify_github_token
from code_review_agent.api.agents.lead_engineer import lead_engineer_router
from code_review_agent.api.config import Settings

_MOD = "code_review_agent.api.agents.lead_engineer"


def _make_app() -> tuple[FastAPI, TaskStore]:
    app = FastAPI()
    store = TaskStore()
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    app.include_router(
        lead_engineer_router(settings, store),
        prefix="/lead-engineer",
    )
    app.dependency_overrides[verify_github_token] = lambda: "ghp_testtoken"
    return app, store


def _send_payload() -> dict:
    return {
        "message": {
            "role": "user",
            "parts": [
                {
                    "kind": "data",
                    "data": {"review_report": {"results": [], "errors": []}},
                }
            ],
        }
    }


class TestAgentCard:
    def test_returns_agent_card(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.get("/lead-engineer/.well-known/agent.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Lead Engineer"
        assert "/lead-engineer" in data["url"]
        assert len(data["skills"]) == 1


class TestSendTask:
    def test_returns_202_with_task_id(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.post("/lead-engineer/tasks/send", json=_send_payload())
        assert resp.status_code == 202
        data = resp.json()
        assert data["task"]["status"] == "submitted"
        assert data["task"]["id"] != ""


class TestGetTask:
    def test_returns_404_for_unknown_task_id(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.get("/lead-engineer/tasks/nonexistent-id")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_background_task_completes(self) -> None:
        from code_review_agent.models.lead_engineer import LeadEngineerReport

        mock_report = LeadEngineerReport(
            overall_summary="All clear.",
            decisions=[],
            reviewer_errors=[],
        )

        app, store = _make_app()
        with (
            patch(f"{_MOD}.LeadEngineerAgent") as mock_agent_cls,
            TestClient(app) as client,
        ):
            mock_instance = MagicMock()
            mock_instance.evaluate.return_value = mock_report
            mock_agent_cls.return_value = mock_instance

            resp = client.post("/lead-engineer/tasks/send", json=_send_payload())
            assert resp.status_code == 202
            task_id = resp.json()["task"]["id"]

            await asyncio.sleep(0.1)

            task = await store.get(task_id)
            assert task is not None
            assert task.status in (A2ATaskStatus.COMPLETED, A2ATaskStatus.WORKING)
