"""FastAPI routers for each stage of the review workflow (per-agent HTTP endpoints)."""

from code_review_agent.api.agents.lead_engineer import lead_engineer_router
from code_review_agent.api.agents.orchestrator import orchestrator_router
from code_review_agent.api.agents.pr_info_collector import pr_info_collector_router
from code_review_agent.api.agents.frontend_reviewer import frontend_reviewer_router
from code_review_agent.api.agents.svelte_reviewer import svelte_reviewer_router
from code_review_agent.api.agents.security_reviewer import security_reviewer_router

__all__ = [
    "pr_info_collector_router",
    "frontend_reviewer_router",
    "svelte_reviewer_router",
    "security_reviewer_router",
    "lead_engineer_router",
    "orchestrator_router",
]
