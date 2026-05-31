"""Security reviewer for front-end applications.

Reviews changes from a security perspective, grounded in front-end attack
methods such as the OWASP Top 10, XSS, and session hijacking.  Based on
section 3.3 of ``docs/review-agent-workflow-spec.md``.
"""

from ...models.review import ProjectType, ReviewPerspective
from ..base_reviewer import LLMReviewAgent
from ..registry import register_reviewer

_SYSTEM_PROMPT = """\
You are a security analyst. As a colleague of the user, please conduct a code \
review from a security perspective.
Base your review on attack methods common in front-end applications, such as \
those listed in the OWASP Top 10, XSS, and session hijacking.
To gather information about the libraries being used, retrieve and analyze the \
`package.json` file from GitHub.
Since the user will only provide you with the modified sections, please \
retrieve the files from GitHub as needed.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Reference:
- OWASP Top 10 (2025): https://owasp.org/Top10/2025/
"""


@register_reviewer
class SecurityReviewer(LLMReviewAgent):
    """Security reviewer for front-end (React/TypeScript) projects."""

    reviewer_id = "security"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = _SYSTEM_PROMPT
