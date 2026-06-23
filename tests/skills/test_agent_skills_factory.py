"""Tests for agent_skills_factory."""

from enum import StrEnum
from unittest.mock import MagicMock, patch

import pytest
from strands import AgentSkills, Skill

from code_review_agent.skills.agent_skills_factory import (
    AgentSkillType,
    create_agent_skills,
)

_MOD = "code_review_agent.skills.agent_skills_factory"


def _skill_mock(name: str) -> MagicMock:
    """Create a MagicMock with `.name` set for AgentSkills compatibility.

    AgentSkills._resolve_skills() accesses source.name to deduplicate skills.
    spec=Skill cannot expose dataclass instance fields, so name must be set explicitly.
    """
    mock = MagicMock()
    mock.name = name
    return mock


class TestAgentSkillType:
    def test_none_value(self):
        assert AgentSkillType.NONE == ""

    def test_frontend_review_value(self):
        assert AgentSkillType.FRONTEND_REVIEW == "frontend_review"

    def test_web_security_review_value(self):
        assert AgentSkillType.WEB_SECURITY_REVIEW == "web_security_review"

    def test_is_str_enum(self):
        assert issubclass(AgentSkillType, StrEnum)
        assert isinstance(AgentSkillType.NONE, str)


class TestCreateAgentSkills:
    def test_returns_agent_skills_instance_none(self):
        result = create_agent_skills(AgentSkillType.NONE)
        assert isinstance(result, AgentSkills)

    def test_default_parameter_behaves_as_none(self):
        with patch(f"{_MOD}.AgentSkills") as mock_agent_skills:
            create_agent_skills()
            mock_agent_skills.assert_called_once_with(skills=[])

    class TestNone:
        def test_passes_empty_skills_list(self):
            with patch(f"{_MOD}.AgentSkills") as mock_agent_skills:
                create_agent_skills(AgentSkillType.NONE)
                mock_agent_skills.assert_called_once_with(skills=[])

        def test_does_not_call_skill_from_file(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                create_agent_skills(AgentSkillType.NONE)
                mock_skill_cls.from_file.assert_not_called()

    class TestFrontendReview:
        _EXPECTED_SKILL_NAMES = [
            "reviewing-universal",
            "reviewing-languages",
            "reviewing-frameworks",
            "reviewing-metaframeworks",
        ]

        def test_calls_skill_from_file_four_times(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.return_value = MagicMock(spec=Skill)
                with patch(f"{_MOD}.AgentSkills"):
                    create_agent_skills(AgentSkillType.FRONTEND_REVIEW)
            assert mock_skill_cls.from_file.call_count == 4

        def test_skill_names_and_order(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.return_value = MagicMock(spec=Skill)
                with patch(f"{_MOD}.AgentSkills"):
                    create_agent_skills(AgentSkillType.FRONTEND_REVIEW)
                actual = [c.args[0] for c in mock_skill_cls.from_file.call_args_list]
            assert (
                actual == TestCreateAgentSkills.TestFrontendReview._EXPECTED_SKILL_NAMES
            )

        def test_passes_all_skills_to_agent_skills(self):
            mock_skills = [MagicMock(spec=Skill) for _ in range(4)]
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.side_effect = mock_skills
                with patch(f"{_MOD}.AgentSkills") as mock_agent_skills:
                    create_agent_skills(AgentSkillType.FRONTEND_REVIEW)
            mock_agent_skills.assert_called_once_with(skills=mock_skills)

        def test_returns_agent_skills_instance(self):
            names = TestCreateAgentSkills.TestFrontendReview._EXPECTED_SKILL_NAMES
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.side_effect = [_skill_mock(n) for n in names]
                result = create_agent_skills(AgentSkillType.FRONTEND_REVIEW)
            assert isinstance(result, AgentSkills)

    class TestWebSecurityReview:
        def test_calls_skill_from_file_once(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.return_value = MagicMock(spec=Skill)
                with patch(f"{_MOD}.AgentSkills"):
                    create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
            assert mock_skill_cls.from_file.call_count == 1

        def test_skill_name(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.return_value = MagicMock(spec=Skill)
                with patch(f"{_MOD}.AgentSkills"):
                    create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
            mock_skill_cls.from_file.assert_called_once_with("web-security-review")

        def test_passes_skill_to_agent_skills(self):
            mock_skill = MagicMock(spec=Skill)
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.return_value = mock_skill
                with patch(f"{_MOD}.AgentSkills") as mock_agent_skills:
                    create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
            mock_agent_skills.assert_called_once_with(skills=[mock_skill])

        def test_returns_agent_skills_instance(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.return_value = _skill_mock(
                    "web-security-review"
                )
                result = create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
            assert isinstance(result, AgentSkills)

    class TestErrorPropagation:
        def test_file_not_found_propagates_for_frontend_review(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.side_effect = FileNotFoundError(
                    "SKILL.md not found"
                )
                with pytest.raises(FileNotFoundError):
                    create_agent_skills(AgentSkillType.FRONTEND_REVIEW)

        def test_value_error_propagates_for_frontend_review(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.side_effect = ValueError("Invalid frontmatter")
                with pytest.raises(ValueError):
                    create_agent_skills(AgentSkillType.FRONTEND_REVIEW)

        def test_file_not_found_propagates_for_web_security_review(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.side_effect = FileNotFoundError(
                    "SKILL.md not found"
                )
                with pytest.raises(FileNotFoundError):
                    create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)

        def test_value_error_propagates_for_web_security_review(self):
            with patch(f"{_MOD}.Skill") as mock_skill_cls:
                mock_skill_cls.from_file.side_effect = ValueError("Invalid frontmatter")
                with pytest.raises(ValueError):
                    create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
