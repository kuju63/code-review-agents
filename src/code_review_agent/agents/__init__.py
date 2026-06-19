"""Agents for code review workflow."""

from .base_reviewer import LLMReviewAgent, ReviewAgent, ReviewerConfig
from .lead_engineer import LeadEngineerAgent
from .pr_info_collector import PRInfoCollector
from .registry import (
    detect_project_types,
    get_registered_reviewers,
    get_reviewer_classes,
    register_reviewer,
)

# Importing the reviewers package registers the concrete reviewers as a side
# effect, so they are discoverable via the registry once `agents` is imported.
from .reviewers import FrontendReviewer, SecurityReviewer

__all__ = [
    "PRInfoCollector",
    "ReviewAgent",
    "LLMReviewAgent",
    "ReviewerConfig",
    "LeadEngineerAgent",
    "register_reviewer",
    "get_registered_reviewers",
    "get_reviewer_classes",
    "detect_project_types",
    "FrontendReviewer",
    "SecurityReviewer",
]
