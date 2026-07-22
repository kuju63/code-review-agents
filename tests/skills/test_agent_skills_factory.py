"""Tests for agent_skills_factory."""

from enum import StrEnum
from pathlib import Path

import pytest
from strands import AgentSkills

from code_review_agent.skills.agent_skills_factory import (
    AgentSkillType,
    create_agent_skills,
)


class TestAgentSkillType:
    def test_none_value(self):
        assert AgentSkillType.NONE == ""

    def test_frontend_review_value(self):
        assert AgentSkillType.FRONTEND_REVIEW == "frontend_review"

    def test_web_security_review_value(self):
        assert AgentSkillType.WEB_SECURITY_REVIEW == "web_security_review"

    def test_angular_review_value(self):
        assert AgentSkillType.ANGULAR_REVIEW == "angular_review"

    def test_is_str_enum(self):
        assert issubclass(AgentSkillType, StrEnum)
        assert isinstance(AgentSkillType.NONE, str)


class TestCreateAgentSkills:
    def test_returns_agent_skills_instance_none(self):
        result = create_agent_skills(AgentSkillType.NONE)
        assert isinstance(result, AgentSkills)

    def test_default_parameter_behaves_as_none(self):
        result = create_agent_skills()
        assert isinstance(result, AgentSkills)
        assert len(result._skills) == 0

    class TestNone:
        def test_does_not_load_any_skills(self):
            result = create_agent_skills(AgentSkillType.NONE)
            assert len(result._skills) == 0

    class TestFrontendReview:
        _EXPECTED_SKILL_NAMES = frozenset(
            {
                "reviewing-universal",
                "reviewing-languages",
                "reviewing-frameworks",
                "reviewing-metaframeworks",
                "vercel-react-best-practices",
                "vercel-composition-patterns",
            }
        )

        def test_returns_agent_skills_instance(self):
            result = create_agent_skills(AgentSkillType.FRONTEND_REVIEW)
            assert isinstance(result, AgentSkills)

        def test_loads_six_skills(self):
            result = create_agent_skills(AgentSkillType.FRONTEND_REVIEW)
            assert len(result._skills) == 6

        def test_skill_names(self):
            result = create_agent_skills(AgentSkillType.FRONTEND_REVIEW)
            assert set(result._skills.keys()) == self._EXPECTED_SKILL_NAMES

    class TestAngularReview:
        _EXPECTED_SKILL_NAMES = frozenset(
            {
                "reviewing-universal",
                "reviewing-languages",
                "reviewing-frameworks",
                "angular-developer",
            }
        )

        def test_returns_agent_skills_instance(self):
            result = create_agent_skills(AgentSkillType.ANGULAR_REVIEW)
            assert isinstance(result, AgentSkills)

        def test_loads_four_skills(self):
            result = create_agent_skills(AgentSkillType.ANGULAR_REVIEW)
            assert len(result._skills) == 4

        def test_skill_names(self):
            result = create_agent_skills(AgentSkillType.ANGULAR_REVIEW)
            assert set(result._skills.keys()) == self._EXPECTED_SKILL_NAMES

    class TestWebSecurityReview:
        def test_returns_agent_skills_instance(self):
            result = create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
            assert isinstance(result, AgentSkills)

        def test_loads_one_skill(self):
            result = create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
            assert len(result._skills) == 1

        def test_skill_name(self):
            result = create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
            assert "reviewing-web-security" in result._skills

    class TestErrorPropagation:
        def test_file_not_found_propagates_for_frontend_review(self, monkeypatch):
            monkeypatch.setattr(
                "code_review_agent.skills.agent_skills_factory._SKILLS_DIR",
                Path("/nonexistent/path"),
            )
            with pytest.raises(FileNotFoundError):
                create_agent_skills(AgentSkillType.FRONTEND_REVIEW)

        def test_file_not_found_propagates_for_web_security_review(self, monkeypatch):
            monkeypatch.setattr(
                "code_review_agent.skills.agent_skills_factory._SKILLS_DIR",
                Path("/nonexistent/path"),
            )
            with pytest.raises(FileNotFoundError):
                create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)

        def test_file_not_found_propagates_for_angular_review(self, monkeypatch):
            monkeypatch.setattr(
                "code_review_agent.skills.agent_skills_factory._SKILLS_DIR",
                Path("/nonexistent/path"),
            )
            with pytest.raises(FileNotFoundError):
                create_agent_skills(AgentSkillType.ANGULAR_REVIEW)
