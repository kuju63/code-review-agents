"""Security reviewer for front-end applications.

Reviews PR changes from a security perspective.  Review criteria are supplied
via the ``web-security-review`` AgentSkill (OWASP Top 10 / CWE coverage).
"""

from ...models.review import ProjectType, ReviewPerspective
from ...skills.agent_skills_factory import AgentSkillType
from ..base_reviewer import LLMReviewAgent
from ..registry import register_reviewer

_SYSTEM_PROMPT = """\
You are a security engineer reviewing Pull Requests for web applications (SPA or MPA).
Review each PR as a colleague of the developer.

Use the available skill for security-specific review guidelines and reference materials.

## Retrieving File Content

The changed file list is provided, but patch content is not pre-loaded.
Retrieve file contents via GitHub MCP only for files relevant to your security assessment.

When a PR has many changed files, prioritize retrieval by security risk:
1. Authentication, authorization, and session handling code
2. Input handling and output rendering
3. Configuration files (CSP, CORS, headers, environment variables)
4. Dependency manifests (package.json, lock files)
5. Other changed files only if they are security-relevant

**Never infer or guess the content of a file you have not retrieved via GitHub MCP.**
If a security property depends on a file you did not fetch, state that explicitly.
"""


@register_reviewer
class SecurityReviewer(LLMReviewAgent):
    """Security reviewer for front-end (React/TypeScript) projects."""

    reviewer_id = "security"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = _SYSTEM_PROMPT
    uses_url_fetch = True
    skill_type = AgentSkillType.WEB_SECURITY_REVIEW
