import pytest
from fastapi.testclient import TestClient

from code_review_agent.api.app import create_app
from code_review_agent.api.config import Settings


def _make_settings() -> Settings:
    return Settings(_env_file=None)  # type: ignore[call-arg]


class TestAgentCards:
    @pytest.mark.parametrize(
        "prefix,expected_name",
        [
            ("pr-info-collector", "PR Info Collector"),
            ("react-reviewer", "React Reviewer"),
            ("security-reviewer", "Security Reviewer"),
            ("lead-engineer", "Lead Engineer"),
            ("orchestrator", "Orchestrator"),
        ],
    )
    def test_returns_agent_card(self, prefix: str, expected_name: str) -> None:
        app = create_app(_make_settings())
        with TestClient(app) as client:
            resp = client.get(f"/{prefix}/.well-known/agent.json")
        assert resp.status_code == 200
        assert resp.json()["name"] == expected_name


class TestSendTaskEndpoints:
    @pytest.mark.parametrize(
        "prefix",
        [
            "pr-info-collector",
            "react-reviewer",
            "security-reviewer",
            "lead-engineer",
            "orchestrator",
        ],
    )
    def test_returns_422_without_auth(self, prefix: str) -> None:
        app = create_app(_make_settings())
        with TestClient(app) as client:
            resp = client.post(
                f"/{prefix}/tasks/send",
                json={
                    "message": {"role": "user", "parts": [{"kind": "data", "data": {}}]}
                },
            )
        assert resp.status_code == 422


class TestGetTaskEndpoints:
    @pytest.mark.parametrize(
        "prefix",
        [
            "pr-info-collector",
            "react-reviewer",
            "security-reviewer",
            "lead-engineer",
            "orchestrator",
        ],
    )
    def test_returns_404_for_unknown_task(self, prefix: str) -> None:
        app = create_app(_make_settings())
        with TestClient(app) as client:
            resp = client.get(f"/{prefix}/tasks/no-such-task")
        assert resp.status_code == 404
