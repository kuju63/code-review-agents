"""Frontend technical reviewer.

Reviews front-end changes as a senior front-end engineer, covering component
design, performance, and correct library usage across frameworks (React, Vue,
Angular, Svelte, Next.js, and others).  Framework-specific review criteria are
provided via AgentSkills from the ``skills/`` directory.
"""

from pathlib import Path

from ...models.review import ProjectType, ReviewPerspective
from ..base_reviewer import LLMReviewAgent
from ..registry import register_reviewer

_SYSTEM_PROMPT = """\
You are a senior front-end engineer. Please conduct a code review as a \
colleague of the user.
Review the code to ensure it follows front-end best practices for the \
frameworks and libraries in use.
To obtain information about the libraries being used, retrieve and parse the \
`package.json` file from GitHub.
Since the user will only provide the modified sections, please retrieve the \
files from GitHub as needed.
The review criteria are component/Hook design, performance, and security.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Use the available skills to apply framework-specific review guidelines based on \
the libraries and frameworks detected in the project.
"""


@register_reviewer
class FrontendReviewer(LLMReviewAgent):
    """Technical reviewer for front-end projects (React, Vue, Angular, Svelte, Next.js, etc.)."""

    reviewer_id = "frontend-technical"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = _SYSTEM_PROMPT
    skills_dir = Path(__file__).parent.parent.parent / "skills"
