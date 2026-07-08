"""Tests for the concrete frontend technical and security reviewers."""

from code_review_agent.agents import registry
from code_review_agent.agents.base_reviewer import (
    STRUCTURED_OUTPUT_DIRECTIVE,
    LLMReviewAgent,
    compose_system_prompt,
)
from code_review_agent.agents.registry import get_reviewer_classes
from code_review_agent.agents.reviewers import FrontendReviewer, SecurityReviewer
from code_review_agent.models.review import ProjectType, ReviewPerspective
from code_review_agent.skills.agent_skills_factory import (
    AgentSkillType,
    create_agent_skills,
)
from strands import AgentSkills


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

    def test_frontend_review_skills_resolve(self):
        result = create_agent_skills(AgentSkillType.FRONTEND_REVIEW)
        assert isinstance(result, AgentSkills)


class TestSecurityReviewer:
    """Security reviewer metadata and prompt."""

    def test_is_llm_review_agent(self):
        assert issubclass(SecurityReviewer, LLMReviewAgent)

    def test_metadata(self):
        assert SecurityReviewer.perspective is ReviewPerspective.SECURITY
        assert ProjectType.REACT_TS in SecurityReviewer.project_types
        assert SecurityReviewer.reviewer_id

    def test_skill_type_is_web_security_review(self):
        assert SecurityReviewer.skill_type is AgentSkillType.WEB_SECURITY_REVIEW

    def test_web_security_review_skills_resolve(self):
        result = create_agent_skills(AgentSkillType.WEB_SECURITY_REVIEW)
        assert isinstance(result, AgentSkills)


class TestStructuredOutputDirective:
    """The shared directive that steers small models to emit the structured
    output tool call instead of a prose Markdown review report."""

    def test_directive_forbids_prose_and_requires_structured_output(self):
        directive = STRUCTURED_OUTPUT_DIRECTIVE.lower()
        # Must tell the model not to write a prose/Markdown report...
        assert "markdown" in directive or "prose" in directive
        # ...and that the final action is the structured output itself.
        assert "structured output" in directive

    def test_compose_appends_directive_to_role_prompt(self):
        composed = compose_system_prompt("ROLE PROMPT")
        assert composed.startswith("ROLE PROMPT")
        assert STRUCTURED_OUTPUT_DIRECTIVE in composed
        assert composed != "ROLE PROMPT"

    def test_reviewers_carry_directive_in_effective_prompt(self):
        for reviewer_cls in (FrontendReviewer, SecurityReviewer):
            composed = compose_system_prompt(reviewer_cls.system_prompt)
            assert STRUCTURED_OUTPUT_DIRECTIVE in composed


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
