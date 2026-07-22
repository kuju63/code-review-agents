from fastapi import FastAPI

from code_review_agent.a2a.task_store import TaskStore
from code_review_agent.api.agents import (
    lead_engineer_router,
    orchestrator_router,
    pr_info_collector_router,
    frontend_reviewer_router,
    svelte_reviewer_router,
    security_reviewer_router,
)
from code_review_agent.api.config import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        settings = Settings()
    app = FastAPI(
        title="Code Review Agent",
        description="A2A-compatible multi-agent code review service.",
        version="1.0.0",
    )
    store = TaskStore()
    app.include_router(
        pr_info_collector_router(settings, store), prefix="/pr-info-collector"
    )
    app.include_router(
        frontend_reviewer_router(settings, store), prefix="/frontend-reviewer"
    )
    app.include_router(
        svelte_reviewer_router(settings, store), prefix="/svelte-reviewer"
    )
    app.include_router(
        security_reviewer_router(settings, store), prefix="/security-reviewer"
    )
    app.include_router(lead_engineer_router(settings, store), prefix="/lead-engineer")
    app.include_router(orchestrator_router(settings, store), prefix="/orchestrator")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
