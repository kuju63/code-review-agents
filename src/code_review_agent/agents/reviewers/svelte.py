"""Svelte technical reviewer.

Reviews Svelte changes as a senior Svelte engineer, covering reactivity
(runes), event handling, snippets, styling, context, and legacy-feature
migration.  Svelte-specific review criteria are provided via AgentSkills from
the ``skills/`` directory, keeping this reviewer configured rather than
re-coded.

When the target PR is not a Svelte project, the reviewer returns no findings so
the downstream Lead Engineer agent is not fed irrelevant Svelte-specific input.
"""

from ...models.review import (
    ProjectType,
    ReviewContext,
    ReviewOutput,
    ReviewPerspective,
    ReviewResult,
)
from ...skills.agent_skills_factory import AgentSkillType
from ..base_reviewer import LLMReviewAgent
from ..registry import detect_project_types, register_reviewer

_SYSTEM_PROMPT = """\
You are a senior Svelte engineer. Please conduct a code review as a colleague \
of the user.
Review the code to ensure it follows Svelte best practices for the Svelte \
version used by the project.
To determine the Svelte version and libraries in use, retrieve and parse the \
`package.json` and `svelte.config.js` files from GitHub.
Since the user will only provide the modified sections, please retrieve the \
files from GitHub as needed.
The review criteria are reactivity (runes), event handling, snippets, styling, \
context, and correct migration away from legacy features.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Use the available skills to apply Svelte-specific review guidelines based on \
the Svelte version and libraries detected in the project.
"""


@register_reviewer
class SvelteReviewer(LLMReviewAgent):
    """Technical reviewer for Svelte projects."""

    reviewer_id = "svelte-technical"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.SVELTE})
    system_prompt = _SYSTEM_PROMPT
    skill_type = AgentSkillType.SVELTE_REVIEW

    def review(
        self,
        context: ReviewContext,
        project_type: ProjectType | None = None,
    ) -> ReviewResult:
        """Review the change, skipping non-Svelte PRs with no findings.

        The project type is re-detected from the PR information so the guard
        holds even when the reviewer is invoked directly through its A2A
        endpoint, where orchestrator-level project-type selection does not
        apply. When the PR is not a Svelte project, an empty result is returned
        without invoking the LLM, so the downstream Lead Engineer agent is not
        fed irrelevant Svelte-specific input.

        Args:
            context: Input boundary wrapping the collected PR information.
            project_type: The project type this review was selected for, used
                to annotate the result. ``None`` when not scoped.

        Returns:
            The reviewer's findings, or an empty result for non-Svelte PRs.
        """
        if ProjectType.SVELTE not in detect_project_types(context.pr_info):
            return ReviewResult(
                reviewer_id=self.reviewer_id,
                perspective=self.perspective,
                project_type=project_type,
                output=ReviewOutput(
                    summary="Not a Svelte project; no Svelte review performed.",
                    findings=[],
                ),
            )
        return super().review(context, project_type)
