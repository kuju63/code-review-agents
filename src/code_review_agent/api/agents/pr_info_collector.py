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
from code_review_agent.agents.pr_info_collector import PRInfoCollector
from code_review_agent.api.agents.common import _extract_data, verify_github_token
from code_review_agent.api.config import Settings
from code_review_agent.models.pr_info import PRInfoResult


async def _run(task_id: str, data: dict, store: TaskStore, settings: Settings) -> None:
    await store.set_working(task_id)
    try:
        collector = PRInfoCollector(
            github_token=data["github_token"],
            model_id=data.get("model_id", settings.model_id),
            llm_base_url=settings.llm_base_url,
            max_agent_turns=settings.max_agent_turns,
            patch_total_char_limit=settings.patch_total_char_limit,
            patch_max_files=settings.patch_max_files,
        )
        result = await asyncio.to_thread(
            collector.collect,
            data["owner"],
            data["repo"],
            data["pr_number"],
        )
        await store.set_completed(task_id, [A2ADataPart(data=result.model_dump())])
    except Exception as exc:
        await store.set_failed(task_id, sanitize_error(exc))


def pr_info_collector_router(settings: Settings, store: TaskStore) -> APIRouter:
    router = APIRouter()

    @router.get("/.well-known/agent.json", response_model=AgentCard)
    async def get_agent_card() -> AgentCard:
        url = settings.resolve_agent_url(
            "pr-info-collector", settings.agent_pr_info_collector_url
        )
        return AgentCard(
            name="PR Info Collector",
            description="Collects pull request information from GitHub and returns structured data for downstream review agents.",
            url=url,
            skills=[
                AgentSkill(
                    id="collect_pr_info",
                    name="Collect PR Information",
                    description="Fetches PR metadata, file changes, and project summary from GitHub using MCP.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "owner": {"type": "string"},
                            "repo": {"type": "string"},
                            "pr_number": {"type": "integer"},
                            "model_id": {"type": "string", "default": "gpt-4o"},
                        },
                        "required": ["owner", "repo", "pr_number"],
                    },
                    outputSchema=PRInfoResult.model_json_schema(),
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
