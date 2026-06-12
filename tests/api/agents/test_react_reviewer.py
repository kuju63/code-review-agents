import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from code_review_agent.a2a.models import A2ATaskStatus
from code_review_agent.a2a.task_store import TaskStore
from code_review_agent.api.agents.common import verify_github_token
from code_review_agent.api.agents.react_reviewer import react_reviewer_router
from code_review_agent.api.config import Settings

_MOD = "code_review_agent.api.agents.react_reviewer"


def _make_app() -> tuple[FastAPI, TaskStore]:
    app = FastAPI()
    store = TaskStore()
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    app.include_router(
        react_reviewer_router(settings, store),
        prefix="/react-reviewer",
    )
    app.dependency_overrides[verify_github_token] = lambda: "ghp_testtoken"
    return app, store


def _pr_info_payload() -> dict:
    return {
        "repository_info": {"owner": "octocat", "repository": "hello"},
        "project_summary": "A project.",
        "pr_info": {
            "title": "Fix",
            "pr_number": 1,
            "body": "",
            "labels": [],
            "file_changes": [],
        },
        "dependency_files": [],
    }


def _send_payload() -> dict:
    return {
        "message": {
            "role": "user",
            "parts": [{"kind": "data", "data": {"pr_info": _pr_info_payload()}}],
        }
    }


class TestAgentCard:
    def test_returns_agent_card(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.get("/react-reviewer/.well-known/agent.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "React Reviewer"
        assert "/react-reviewer" in data["url"]
        assert len(data["skills"]) == 1


class TestSendTask:
    def test_returns_202_with_task_id(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.post("/react-reviewer/tasks/send", json=_send_payload())
        assert resp.status_code == 202
        data = resp.json()
        assert data["task"]["status"] == "submitted"
        assert data["task"]["id"] != ""


class TestGetTask:
    def test_returns_404_for_unknown_task_id(self) -> None:
        app, _ = _make_app()
        with TestClient(app) as client:
            resp = client.get("/react-reviewer/tasks/nonexistent-id")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_background_task_completes(self) -> None:
        from code_review_agent.models.review import (
            ReviewOutput,
            ReviewPerspective,
            ReviewResult,
        )

        mock_result = ReviewResult(
            reviewer_id="react-technical",
            perspective=ReviewPerspective.TECHNICAL,
            project_type=None,
            output=ReviewOutput(summary="Looks good.", findings=[]),
        )

        app, store = _make_app()
        with (
            patch(f"{_MOD}.ReactCodeReviewer") as mock_reviewer_cls,
            TestClient(app) as client,
        ):
            mock_instance = MagicMock()
            mock_instance.review.return_value = mock_result
            mock_reviewer_cls.return_value = mock_instance

            resp = client.post("/react-reviewer/tasks/send", json=_send_payload())
            assert resp.status_code == 202
            task_id = resp.json()["task"]["id"]

            await asyncio.sleep(0.1)

            task = await store.get(task_id)
            assert task is not None
            assert task.status in (A2ATaskStatus.COMPLETED, A2ATaskStatus.WORKING)
