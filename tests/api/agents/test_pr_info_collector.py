import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from code_review_agent.a2a.models import A2ATaskStatus
from code_review_agent.a2a.task_store import TaskStore
from code_review_agent.api.agents.common import verify_github_token
from code_review_agent.api.agents.pr_info_collector import pr_info_collector_router
from code_review_agent.api.config import Settings

_MOD = "code_review_agent.api.agents.pr_info_collector"


def _make_app() -> tuple[FastAPI, TaskStore]:
    app = FastAPI()
    store = TaskStore()
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    app.include_router(
        pr_info_collector_router(settings, store),
        prefix="/pr-info-collector",
    )
    app.dependency_overrides[verify_github_token] = lambda: "ghp_testtoken"
    return app, store


def _send_payload(
    owner: str = "octocat", repo: str = "hello", pr_number: int = 1
) -> dict:
    return {
        "message": {
            "role": "user",
            "parts": [
                {
                    "kind": "data",
                    "data": {"owner": owner, "repo": repo, "pr_number": pr_number},
                }
            ],
        }
    }


class TestAgentCard:
    def test_returns_agent_card(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.get("/pr-info-collector/.well-known/agent.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "PR Info Collector"
        assert "/pr-info-collector" in data["url"]
        assert len(data["skills"]) == 1


class TestSendTask:
    def test_returns_202_with_task_id(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.post(
                "/pr-info-collector/tasks/send",
                json=_send_payload(),
            )
        assert resp.status_code == 202
        data = resp.json()
        assert "task" in data
        assert data["task"]["status"] == "submitted"
        assert data["task"]["id"] != ""

    def test_requires_authorization_header_when_dependency_not_overridden(self) -> None:
        app = FastAPI()
        store = TaskStore()
        settings = Settings(_env_file=None)  # type: ignore[call-arg]
        app.include_router(
            pr_info_collector_router(settings, store),
            prefix="/pr-info-collector",
        )
        with TestClient(app) as client:
            resp = client.post(
                "/pr-info-collector/tasks/send",
                json=_send_payload(),
            )
        assert resp.status_code == 422


class TestGetTask:
    def test_returns_404_for_unknown_task_id(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.get("/pr-info-collector/tasks/nonexistent-id")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_background_task_completes(self) -> None:
        from code_review_agent.models.pr_info import (
            PRInfo,
            PRInfoResult,
            RepositoryInfo,
        )

        mock_result = PRInfoResult(
            repository_info=RepositoryInfo(owner="octocat", repository="hello"),
            project_summary="A project.",
            pr_info=PRInfo(
                title="Fix", pr_number=1, body="", labels=[], file_changes=[]
            ),
            dependency_files=[],
        )

        app, store = _make_app()
        with (
            patch(f"{_MOD}.PRInfoCollector") as mock_collector_cls,
            TestClient(app) as client,
        ):
            mock_instance = MagicMock()
            mock_instance.collect.return_value = mock_result
            mock_collector_cls.return_value = mock_instance

            resp = client.post(
                "/pr-info-collector/tasks/send",
                json=_send_payload(),
            )
            assert resp.status_code == 202
            task_id = resp.json()["task"]["id"]

            await asyncio.sleep(0.1)

            task = await store.get(task_id)
            assert task is not None
            assert task.status in (A2ATaskStatus.COMPLETED, A2ATaskStatus.WORKING)
