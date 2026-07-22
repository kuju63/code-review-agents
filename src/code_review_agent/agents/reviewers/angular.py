"""Angular technical reviewer."""

from ...models.review import ProjectType, ReviewPerspective
from ...skills.agent_skills_factory import AgentSkillType
from ..base_reviewer import LLMReviewAgent
from ..registry import register_reviewer

_SYSTEM_PROMPT = """\
You are a senior Angular engineer. Review Angular pull request changes as a colleague of the user.
"""


@register_reviewer
class AngularReviewer(LLMReviewAgent):
    """Technical reviewer for Angular projects."""

    reviewer_id = "angular-technical"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.ANGULAR})
    system_prompt = _SYSTEM_PROMPT
    skill_type = AgentSkillType.ANGULAR_REVIEW
