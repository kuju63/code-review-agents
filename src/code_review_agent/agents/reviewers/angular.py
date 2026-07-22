"""Angular technical reviewer.

Reviews Angular changes as a senior Angular engineer, covering component and
service design, reactivity (signals), change detection, dependency injection,
and template correctness.  Angular-specific review criteria are provided via
AgentSkills from the ``skills/`` directory, keeping this reviewer configured
rather than re-coded.
"""

from ...models.review import ProjectType, ReviewPerspective
from ...skills.agent_skills_factory import AgentSkillType
from ..base_reviewer import LLMReviewAgent
from ..registry import register_reviewer

_SYSTEM_PROMPT = """\
You are a senior Angular engineer. Please conduct a code review as a colleague \
of the user.
Review the code to ensure it follows Angular best practices for the Angular \
version used by the project.
To determine the Angular version and libraries in use, retrieve and parse the \
`package.json` file from GitHub.
Since the user will only provide the modified sections, please retrieve the \
files from GitHub as needed.
The review criteria are component/service design, reactivity (signals), change \
detection, dependency injection, and template correctness.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Use the available skills to apply Angular-specific review guidelines based on \
the Angular version and libraries detected in the project.
"""


@register_reviewer
class AngularReviewer(LLMReviewAgent):
    """Technical reviewer for Angular projects."""

    reviewer_id = "angular-technical"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.ANGULAR})
    system_prompt = _SYSTEM_PROMPT
    skill_type = AgentSkillType.ANGULAR_REVIEW
