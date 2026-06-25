import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from code_review_agent.a2a.models import (
    A2ADataPart,
    A2ASendTaskRequest,
    A2ASendTaskResponse,
    A2ATask,
    AgentCard,
    AgentSkill,
)
from code_review_agent.a2a.sanitizers import sanitize_error
from code_review_agent.a2a.task_store import TaskStore
from code_review_agent.agents.base_reviewer import ReviewerConfig
from code_review_agent.agents.reviewers.frontend import FrontendReviewer
from code_review_agent.api.agents.common import (
    ReviewerSkillInput,
    _extract_data,
    verify_github_token,
)
from code_review_agent.api.config import Settings
from code_review_agent.models.pr_info import PRInfoResult
from code_review_agent.models.review import ReviewContext, ReviewResult


async def _run(task_id: str, data: dict, store: TaskStore, settings: Settings) -> None:
    await store.set_working(task_id)
    try:
        pr_info = PRInfoResult.model_validate(data["pr_info"])
        context = ReviewContext(pr_info=pr_info)
        config = ReviewerConfig(
            github_token=data["github_token"],
            model_id=data.get("model_id", settings.model_id),
            llm_base_url=settings.llm_base_url,
            max_agent_turns=settings.max_agent_turns,
            reviewer_timeout_seconds=settings.reviewer_timeout_seconds,
        )
        reviewer = FrontendReviewer(config)
        result = await asyncio.to_thread(reviewer.review, context)
        await store.set_completed(task_id, [A2ADataPart(data=result.model_dump())])
    except Exception as exc:
        await store.set_failed(task_id, sanitize_error(exc))


def frontend_reviewer_router(settings: Settings, store: TaskStore) -> APIRouter:
    router = APIRouter()

    @router.get("/.well-known/agent.json", response_model=AgentCard)
    async def get_agent_card() -> AgentCard:
        url = settings.resolve_agent_url(
            "frontend-reviewer", settings.agent_frontend_reviewer_url
        )
        return AgentCard(
            name="Frontend Reviewer",
            description="Reviews front-end pull requests (React, Vue, Angular, Svelte, Next.js, etc.) for component design, performance, and correct library usage.",
            url=url,
            skills=[
                AgentSkill(
                    id="review_frontend_pr",
                    name="Review Frontend PR",
                    description="Performs a technical code review for a front-end PR using GitHub MCP and framework-specific skills.",
                    inputSchema=ReviewerSkillInput.model_json_schema(),
                    outputSchema=ReviewResult.model_json_schema(),
                )
            ],
        )

    @router.post("/tasks/send", response_model=A2ASendTaskResponse, status_code=202)
    async def send_task(
        req: A2ASendTaskRequest,
        background_tasks: BackgroundTasks,
        github_token: str = Depends(verify_github_token),
    ) -> A2ASendTaskResponse:
        task = await store.create()
        data = _extract_data(req.message)
        data["github_token"] = github_token
        background_tasks.add_task(_run, task.id, data, store, settings)
        return A2ASendTaskResponse(task=task)

    @router.get("/tasks/{task_id}", response_model=A2ATask)
    async def get_task(task_id: str) -> A2ATask:
        task = await store.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return task

    return router
