import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from code_review_agent.a2a.models import A2ATaskStatus
from code_review_agent.a2a.task_store import TaskStore
from code_review_agent.api.agents.common import verify_github_token
from code_review_agent.api.agents.orchestrator import orchestrator_router
from code_review_agent.api.config import Settings

_MOD = "code_review_agent.api.agents.orchestrator"


def _make_app() -> tuple[FastAPI, TaskStore]:
    app = FastAPI()
    store = TaskStore()
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    app.include_router(
        orchestrator_router(settings, store),
        prefix="/orchestrator",
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
                    "data": {"owner": "octocat", "repo": "hello", "pr_number": 1},
                }
            ],
        }
    }


class TestAgentCard:
    def test_returns_agent_card(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.get("/orchestrator/.well-known/agent.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Orchestrator"
        assert "/orchestrator" in data["url"]
        assert len(data["skills"]) == 1


class TestSendTask:
    def test_returns_202_with_task_id(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.post("/orchestrator/tasks/send", json=_send_payload())
        assert resp.status_code == 202
        data = resp.json()
        assert data["task"]["status"] == "submitted"
        assert data["task"]["id"] != ""


class TestGetTask:
    def test_returns_404_for_unknown_task_id(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.get("/orchestrator/tasks/nonexistent-id")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_background_task_runs_full_pipeline(self) -> None:
        from code_review_agent.models.lead_engineer import LeadEngineerReport
        from code_review_agent.models.pr_info import (
            PRInfo,
            PRInfoResult,
            RepositoryInfo,
        )
        from code_review_agent.models.review import ReviewReport

        mock_pr_info = PRInfoResult(
            repository_info=RepositoryInfo(owner="octocat", repository="hello"),
            project_summary="A project.",
            pr_info=PRInfo(
                title="Fix", pr_number=1, body="", labels=[], file_changes=[]
            ),
            dependency_files=[],
        )
        mock_review_report = ReviewReport(results=[], errors=[])
        mock_le_report = LeadEngineerReport(
            overall_summary="All clear.",
            decisions=[],
            reviewer_errors=[],
        )

        app, store = _make_app()
        with (
            patch(f"{_MOD}.PRInfoCollector") as mock_collector_cls,
            patch(f"{_MOD}.ReviewOrchestrator") as mock_orchestrator_cls,
            patch(f"{_MOD}.LeadEngineerAgent") as mock_le_cls,
            TestClient(app) as client,
        ):
            mock_collector = MagicMock()
            mock_collector.collect.return_value = mock_pr_info
            mock_collector_cls.return_value = mock_collector

            mock_orchestrator = MagicMock()
            mock_orchestrator.run_async = AsyncMock(return_value=mock_review_report)
            mock_orchestrator_cls.return_value = mock_orchestrator

            mock_le = MagicMock()
            mock_le.evaluate.return_value = mock_le_report
            mock_le_cls.return_value = mock_le

            resp = client.post("/orchestrator/tasks/send", json=_send_payload())
            assert resp.status_code == 202
            task_id = resp.json()["task"]["id"]

            await asyncio.sleep(0.2)

            task = await store.get(task_id)
            assert task is not None
            assert task.status in (A2ATaskStatus.COMPLETED, A2ATaskStatus.WORKING)
