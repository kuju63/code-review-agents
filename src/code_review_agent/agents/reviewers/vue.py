"""Vue technical reviewer.

Reviews Vue changes as a senior Vue engineer, covering component design
(Composition API vs Options API), reactivity, computed/watch usage, and
template correctness.  Vue-specific review criteria are provided via
AgentSkills from the ``skills/`` directory, keeping this reviewer configured
rather than re-coded.

No official Vue skill package is vendored yet (unlike Angular's
``angular-developer`` or Svelte's ``svelte-core-bestpractices``); see
docs/seeded-reviewer-stack-routing-spec.md §4 for the follow-up.
"""

from ...models.review import ProjectType, ReviewPerspective
from ...skills.agent_skills_factory import AgentSkillType
from ..base_reviewer import LLMReviewAgent
from ..registry import register_reviewer

_SYSTEM_PROMPT = """\
You are a senior Vue engineer. Please conduct a code review as a colleague \
of the user.
Review the code to ensure it follows Vue best practices for the Vue version \
used by the project.
To determine the Vue version and libraries in use, retrieve and parse the \
`package.json` file from GitHub.
Since the user will only provide the modified sections, please retrieve the \
files from GitHub as needed.
The review criteria are component design (Composition API vs Options API), \
reactivity, computed/watch usage, and template correctness.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Use the available skills to apply Vue-specific review guidelines based on the \
Vue version and libraries detected in the project.
"""


@register_reviewer
class VueReviewer(LLMReviewAgent):
    """Technical reviewer for Vue projects."""

    reviewer_id = "vue-technical"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.VUE})
    system_prompt = _SYSTEM_PROMPT
    skill_type = AgentSkillType.VUE_REVIEW
