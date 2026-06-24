from enum import StrEnum
from pathlib import Path
from typing import TypeAlias

from strands import AgentSkills, Skill

# Mirrors strands.vended_plugins.skills.agent_skills.SkillSource, which is not a public export.
SkillSource: TypeAlias = str | Path | Skill

_SKILLS_DIR = Path(__file__).parent


class AgentSkillType(StrEnum):
    """
    Enum representing different types of agent skills.
    """

    NONE = ""
    FRONTEND_REVIEW = "frontend_review"
    WEB_SECURITY_REVIEW = "web_security_review"


def create_agent_skills(
    skill_type: AgentSkillType = AgentSkillType.NONE,
) -> AgentSkills:
    """
    Create an AgentSkills instance with the skills directory.

    Returns:
        AgentSkills: An instance of AgentSkills with the skills directory.
    """
    skills: list[SkillSource] = []
    if skill_type == AgentSkillType.FRONTEND_REVIEW:
        skills = _build_frontend_review_skills()
    elif skill_type == AgentSkillType.WEB_SECURITY_REVIEW:
        skills = _build_web_security_review_skills()

    return AgentSkills(skills=skills)


def _build_frontend_review_skills() -> list[SkillSource]:
    """
    Build a list of skills for frontend review.

    Returns:
        list[SkillSource]: A list of Skill instances for frontend review.
    """
    return [
        Skill.from_file(_SKILLS_DIR / "reviewing-universal"),
        Skill.from_file(_SKILLS_DIR / "reviewing-languages"),
        Skill.from_file(_SKILLS_DIR / "reviewing-frameworks"),
        Skill.from_file(_SKILLS_DIR / "reviewing-metaframeworks"),
    ]


def _build_web_security_review_skills() -> list[SkillSource]:
    """
    Build a list of skills for web security review.
    Returns:
        list[SkillSource]: A list of Skill instances for web security review.
    """
    return [Skill.from_file(_SKILLS_DIR / "web-security-review")]
