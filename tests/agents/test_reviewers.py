"""Tests for the concrete frontend technical and security reviewers."""

from unittest.mock import patch

from code_review_agent.agents import registry
from code_review_agent.agents.base_reviewer import (
    STRUCTURED_OUTPUT_DIRECTIVE,
    LLMReviewAgent,
    ReviewerConfig,
    compose_system_prompt,
)
from code_review_agent.agents.registry import get_reviewer_classes
from code_review_agent.agents.reviewers import (
    AngularReviewer,
    FrontendReviewer,
    SecurityReviewer,
    SvelteReviewer,
)
from code_review_agent.models.pr_info import (
    FileChange,
    PRInfo,
    PRInfoResult,
    RepositoryInfo,
)
from code_review_agent.models.review import (
    ProjectType,
    ReviewContext,
    ReviewPerspective,
)
from code_review_agent.skills.agent_skills_factory import (
    AgentSkillType,
    create_agent_skills,
)
from strands import AgentSkills

_BASE = "code_review_agent.agents.base_reviewer"


def _context(*, file_paths: list[str], dependency_files: list[str]) -> ReviewContext:
    pr_info = PRInfoResult(
        repository_info=RepositoryInfo(owner="o", repository="r"),
        project_summary="s",
        pr_info=PRInfo(
            title="t",
            pr_number=1,
            file_changes=[FileChange(filePath=p) for p in file_paths],
        ),
        dependency_files=dependency_files,
    )
    return ReviewContext(pr_info=pr_info)


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


class TestAngularReviewer:
    """Angular technical reviewer metadata and prompt."""

    def test_is_llm_review_agent(self):
        assert issubclass(AngularReviewer, LLMReviewAgent)

    def test_metadata(self):
        assert AngularReviewer.perspective is ReviewPerspective.TECHNICAL
        assert AngularReviewer.project_types == frozenset({ProjectType.ANGULAR})
        assert AngularReviewer.reviewer_id == "angular-technical"

    def test_skill_type_is_angular_review(self):
        assert AngularReviewer.skill_type is AgentSkillType.ANGULAR_REVIEW

    def test_angular_review_skills_resolve(self):
        result = create_agent_skills(AgentSkillType.ANGULAR_REVIEW)
        assert isinstance(result, AgentSkills)


class TestSvelteReviewer:
    """Svelte technical reviewer metadata, prompt, and non-Svelte guard."""

    def test_is_llm_review_agent(self):
        assert issubclass(SvelteReviewer, LLMReviewAgent)

    def test_metadata(self):
        assert SvelteReviewer.perspective is ReviewPerspective.TECHNICAL
        assert SvelteReviewer.project_types == frozenset({ProjectType.SVELTE})
        assert SvelteReviewer.reviewer_id == "svelte-technical"

    def test_skill_type_is_svelte_review(self):
        assert SvelteReviewer.skill_type is AgentSkillType.SVELTE_REVIEW

    def test_svelte_review_skills_resolve(self):
        result = create_agent_skills(AgentSkillType.SVELTE_REVIEW)
        assert isinstance(result, AgentSkills)

    def test_non_svelte_pr_returns_empty_without_invoking_llm(self):
        reviewer = SvelteReviewer(ReviewerConfig(github_token="t"))
        context = _context(
            file_paths=["src/App.tsx"], dependency_files=["package.json"]
        )
        with patch(f"{_BASE}.Agent") as mock_agent_cls:
            result = reviewer.review(context, ProjectType.SVELTE)
        mock_agent_cls.assert_not_called()
        assert result.reviewer_id == "svelte-technical"
        assert result.perspective is ReviewPerspective.TECHNICAL
        assert result.output.findings == []

    def test_svelte_pr_delegates_to_llm_review(self):
        reviewer = SvelteReviewer(ReviewerConfig(github_token="t"))
        context = _context(file_paths=["src/App.svelte"], dependency_files=[])
        sentinel = object()
        with patch.object(
            LLMReviewAgent, "review", return_value=sentinel
        ) as mock_super:
            result = reviewer.review(context, ProjectType.SVELTE)
        mock_super.assert_called_once()
        assert result is sentinel


class TestSecurityReviewer:
    """Security reviewer metadata and prompt."""

    def test_is_llm_review_agent(self):
        assert issubclass(SecurityReviewer, LLMReviewAgent)

    def test_metadata(self):
        assert SecurityReviewer.perspective is ReviewPerspective.SECURITY
        assert ProjectType.REACT_TS in SecurityReviewer.project_types
        assert ProjectType.ANGULAR in SecurityReviewer.project_types
        assert ProjectType.SVELTE in SecurityReviewer.project_types
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
        for reviewer_cls in (
            AngularReviewer,
            FrontendReviewer,
            SecurityReviewer,
            SvelteReviewer,
        ):
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

    def test_angular_reviewers_registered_and_selected(self):
        registered = registry.get_registered_reviewers()
        selected = get_reviewer_classes(ProjectType.ANGULAR)

        assert AngularReviewer in registered
        assert AngularReviewer in selected
        assert SecurityReviewer in selected
        assert FrontendReviewer not in selected

    def test_svelte_reviewers_registered_and_selected(self):
        registered = registry.get_registered_reviewers()
        selected = get_reviewer_classes(ProjectType.SVELTE)

        assert SvelteReviewer in registered
        assert SvelteReviewer in selected
        assert SecurityReviewer in selected
        assert FrontendReviewer not in selected
        assert AngularReviewer not in selected
