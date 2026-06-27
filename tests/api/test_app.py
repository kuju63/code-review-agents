import json

import pytest
from fastapi.testclient import TestClient

from code_review_agent.api.app import create_app
from code_review_agent.api.config import Settings

_ALL_PREFIXES = [
    "pr-info-collector",
    "frontend-reviewer",
    "security-reviewer",
    "lead-engineer",
    "orchestrator",
]


def _make_settings() -> Settings:
    return Settings(_env_file=None)  # type: ignore[call-arg]


class TestAgentCards:
    @pytest.mark.parametrize(
        "prefix,expected_name",
        [
            ("pr-info-collector", "PR Info Collector"),
            ("frontend-reviewer", "Frontend Reviewer"),
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


class TestSkillSchemasSelfContained:
    """Skill input/output schemas must be resolvable standalone JSON Schemas.

    The AgentCard document has no `components` section, so any
    `#/components/...` $ref would be a dangling, non-resolvable reference for
    JSON Schema tooling and A2A clients.
    """

    @pytest.mark.parametrize("prefix", _ALL_PREFIXES)
    def test_no_dangling_component_refs(self, prefix: str) -> None:
        app = create_app(_make_settings())
        with TestClient(app) as client:
            card = client.get(f"/{prefix}/.well-known/agent.json").json()
        assert "#/components/" not in json.dumps(card)

    @pytest.mark.parametrize("prefix", _ALL_PREFIXES)
    def test_skill_schemas_are_objects(self, prefix: str) -> None:
        app = create_app(_make_settings())
        with TestClient(app) as client:
            card = client.get(f"/{prefix}/.well-known/agent.json").json()
        for skill in card["skills"]:
            for key in ("inputSchema", "outputSchema"):
                schema = skill[key]
                # A self-contained schema is an object (it may carry $defs);
                # a bare {"$ref": ...} pointing outside the document is not.
                assert schema.get("type") == "object", (
                    f"{prefix} skill {key} is not a self-contained object schema"
                )


class TestSendTaskEndpoints:
    @pytest.mark.parametrize(
        "prefix",
        [
            "pr-info-collector",
            "frontend-reviewer",
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


class TestHealthEndpoint:
    def test_returns_200(self) -> None:
        app = create_app(_make_settings())
        with TestClient(app) as client:
            resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestGetTaskEndpoints:
    @pytest.mark.parametrize(
        "prefix",
        [
            "pr-info-collector",
            "frontend-reviewer",
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
