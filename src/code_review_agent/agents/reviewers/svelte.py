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
    ReviewPerspective,
    ReviewResult,
)
from ...skills.agent_skills_factory import AgentSkillType
from ..base_reviewer import LLMReviewAgent
from ..registry import register_reviewer

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
        return super().review(context, project_type)
