"""Tests for the concrete React technical and security reviewers."""

from code_review_agent.agents import registry
from code_review_agent.agents.base_reviewer import LLMReviewAgent
from code_review_agent.agents.registry import get_reviewer_classes
from code_review_agent.agents.reviewers import ReactCodeReviewer, SecurityReviewer
from code_review_agent.models.review import ProjectType, ReviewPerspective


class TestReactCodeReviewer:
    """React technical reviewer metadata and prompt."""

    def test_is_llm_review_agent(self):
        assert issubclass(ReactCodeReviewer, LLMReviewAgent)

    def test_metadata(self):
        assert ReactCodeReviewer.perspective is ReviewPerspective.TECHNICAL
        assert ReactCodeReviewer.project_types == frozenset({ProjectType.REACT_TS})
        assert ReactCodeReviewer.reviewer_id

    def test_system_prompt_mentions_react(self):
        prompt = ReactCodeReviewer.system_prompt
        assert "React" in prompt
        assert "package.json" in prompt


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


class TestRegistration:
    """Importing the reviewers package registers both reviewers."""

    def test_both_registered_for_react_ts(self):
        registered = registry.get_registered_reviewers()
        assert ReactCodeReviewer in registered
        assert SecurityReviewer in registered

    def test_selected_for_react_ts(self):
        selected = get_reviewer_classes(ProjectType.REACT_TS)
        assert ReactCodeReviewer in selected
        assert SecurityReviewer in selected

    def test_both_perspectives_present(self):
        selected = get_reviewer_classes(ProjectType.REACT_TS)
        perspectives = {cls.perspective for cls in selected}
        assert ReviewPerspective.TECHNICAL in perspectives
        assert ReviewPerspective.SECURITY in perspectives
