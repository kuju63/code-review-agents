"""Tests for the concrete frontend technical and security reviewers."""

from code_review_agent.agents import registry
from code_review_agent.agents.base_reviewer import LLMReviewAgent
from code_review_agent.agents.registry import get_reviewer_classes
from code_review_agent.agents.reviewers import FrontendReviewer, SecurityReviewer
from code_review_agent.models.review import ProjectType, ReviewPerspective
from code_review_agent.skills.agent_skills_factory import AgentSkillType


class TestFrontendReviewer:
    """Frontend technical reviewer metadata and prompt."""

    def test_is_llm_review_agent(self):
        assert issubclass(FrontendReviewer, LLMReviewAgent)

    def test_metadata(self):
        assert FrontendReviewer.perspective is ReviewPerspective.TECHNICAL
        assert FrontendReviewer.project_types == frozenset({ProjectType.REACT_TS})
        assert FrontendReviewer.reviewer_id

    def test_system_prompt_mentions_frontend(self):
        prompt = FrontendReviewer.system_prompt
        assert "front-end" in prompt
        assert "package.json" in prompt

    def test_skill_type_is_frontend_review(self):
        assert FrontendReviewer.skill_type is AgentSkillType.FRONTEND_REVIEW


class TestSecurityReviewer:
    """Security reviewer metadata and prompt."""

    def test_is_llm_review_agent(self):
        assert issubclass(SecurityReviewer, LLMReviewAgent)

    def test_metadata(self):
        assert SecurityReviewer.perspective is ReviewPerspective.SECURITY
        assert ProjectType.REACT_TS in SecurityReviewer.project_types
        assert SecurityReviewer.reviewer_id

    def test_system_prompt_mentions_owasp(self):
        assert "OWASP" in SecurityReviewer.system_prompt

    def test_skill_type_is_web_security_review(self):
        assert SecurityReviewer.skill_type is AgentSkillType.WEB_SECURITY_REVIEW


class TestRegistration:
    """Importing the reviewers package registers both reviewers."""

    def test_both_registered_for_react_ts(self):
        registered = registry.get_registered_reviewers()
        assert FrontendReviewer in registered
        assert SecurityReviewer in registered

    def test_selected_for_react_ts(self):
        selected = get_reviewer_classes(ProjectType.REACT_TS)
        assert FrontendReviewer in selected
        assert SecurityReviewer in selected

    def test_both_perspectives_present(self):
        selected = get_reviewer_classes(ProjectType.REACT_TS)
        perspectives = {cls.perspective for cls in selected}
        assert ReviewPerspective.TECHNICAL in perspectives
        assert ReviewPerspective.SECURITY in perspectives
