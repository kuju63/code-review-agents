"""React/TypeScript technical reviewer.

Reviews front-end changes as a senior React engineer, focused on
component/Hook design, performance, and correct library usage.  Based on
section 3.2 of ``docs/review-agent-workflow-spec.md``.
"""

from ...models.review import ProjectType, ReviewPerspective
from ..base_reviewer import LLMReviewAgent
from ..registry import register_reviewer

_SYSTEM_PROMPT = """\
You are a senior front-end engineer. Please conduct a code review as a \
colleague of the user.
Review the code to ensure it follows React best practices and does not misuse \
the APIs of other relevant libraries.
To obtain information about the libraries being used, retrieve and parse the \
`package.json` file from GitHub.
Since the user will only provide the modified sections, please retrieve the \
files from GitHub as needed.
The review criteria are component/Hook design, performance, and security.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Rules:
- React Best Practices: https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/AGENTS.md
- React Composition Pattern: https://github.com/vercel-labs/agent-skills/blob/main/skills/composition-patterns/AGENTS.md
"""


@register_reviewer
class ReactCodeReviewer(LLMReviewAgent):
    """Technical reviewer for React/TypeScript projects."""

    reviewer_id = "react-technical"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = _SYSTEM_PROMPT
