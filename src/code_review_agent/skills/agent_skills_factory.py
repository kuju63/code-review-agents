from enum import StrEnum
from pathlib import Path
from typing import TypeAlias

from strands import AgentSkills, Skill

# Mirrors strands.vended_plugins.skills.agent_skills.SkillSource, which is not a public export.
SkillSource: TypeAlias = str | Path | Skill

_SKILLS_DIR = Path(__file__).parent


class AgentSkillType(StrEnum):
    """Skill bundles available to LLM-backed reviewers."""

    NONE = ""
    FRONTEND_REVIEW = "frontend_review"
    WEB_SECURITY_REVIEW = "web_security_review"
    ANGULAR_REVIEW = "angular_review"
    SVELTE_REVIEW = "svelte_review"


def create_agent_skills(
    skill_type: AgentSkillType = AgentSkillType.NONE,
) -> AgentSkills:
    """Create an AgentSkills plugin for a reviewer skill bundle.

    Args:
        skill_type: Bundle identifying which local skills to load.

    Returns:
        AgentSkills: Plugin containing the selected local skills.
    """
    skills: list[SkillSource] = []
    if skill_type == AgentSkillType.FRONTEND_REVIEW:
        skills = _build_frontend_review_skills()
    elif skill_type == AgentSkillType.ANGULAR_REVIEW:
        skills = _build_angular_review_skills()
    elif skill_type == AgentSkillType.SVELTE_REVIEW:
        skills = _build_svelte_review_skills()
    elif skill_type == AgentSkillType.WEB_SECURITY_REVIEW:
        skills = _build_web_security_review_skills()

    return AgentSkills(skills=skills)


def _build_frontend_review_skills() -> list[SkillSource]:
    """Build the skill bundle for the frontend technical reviewer.

    The bundle combines the project's generic frontend review skills with
    Vercel's React/Next.js skills so the reviewer can apply React-specific
    performance and composition guidance in addition to framework-agnostic
    checks.

    Returns:
        list[SkillSource]: Skill instances loaded for frontend review.
    """
    return [
        Skill.from_file(_SKILLS_DIR / "reviewing-universal"),
        Skill.from_file(_SKILLS_DIR / "reviewing-languages"),
        Skill.from_file(_SKILLS_DIR / "reviewing-frameworks"),
        Skill.from_file(_SKILLS_DIR / "reviewing-metaframeworks"),
        Skill.from_file(_SKILLS_DIR / "vercel-react-best-practices"),
        Skill.from_file(_SKILLS_DIR / "vercel-composition-patterns"),
    ]


def _build_angular_review_skills() -> list[SkillSource]:
    """Build the skill bundle for the Angular technical reviewer.

    The bundle pairs the project's generic frontend and language review skills
    with Angular's official ``angular-developer`` skill so Angular-specific
    review criteria are applied without routing Angular changes through the
    React-oriented frontend reviewer.

    Returns:
        list[SkillSource]: Skill instances loaded for Angular review.
    """
    return [
        Skill.from_file(_SKILLS_DIR / "reviewing-universal"),
        Skill.from_file(_SKILLS_DIR / "reviewing-languages"),
        Skill.from_file(_SKILLS_DIR / "reviewing-frameworks"),
        Skill.from_file(_SKILLS_DIR / "angular-developer"),
    ]


def _build_svelte_review_skills() -> list[SkillSource]:
    """Build the skill bundle for the Svelte technical reviewer.

    The bundle pairs the project's generic frontend and language review skills
    with Svelte's official ``svelte-core-bestpractices`` skill so Svelte-specific
    review criteria are applied without routing Svelte changes through the
    React-oriented frontend reviewer.

    Returns:
        list[SkillSource]: Skill instances loaded for Svelte review.
    """
    return [
        Skill.from_file(_SKILLS_DIR / "reviewing-universal"),
        Skill.from_file(_SKILLS_DIR / "reviewing-languages"),
        Skill.from_file(_SKILLS_DIR / "reviewing-frameworks"),
        Skill.from_file(_SKILLS_DIR / "svelte-core-bestpractices"),
    ]


def _build_web_security_review_skills() -> list[SkillSource]:
    """Build the skill bundle for the web security reviewer.

    Returns:
        list[SkillSource]: Skill instances loaded for web security review.
    """
    return [Skill.from_file(_SKILLS_DIR / "web-security-review")]
