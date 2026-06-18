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
from code_review_agent.agents.lead_engineer import LeadEngineerAgent
from code_review_agent.api.agents.common import (
    LeadEngineerSkillInput,
    _extract_data,
    verify_github_token,
)
from code_review_agent.api.config import Settings
from code_review_agent.models.lead_engineer import LeadEngineerReport
from code_review_agent.models.review import ReviewReport


async def _run(task_id: str, data: dict, store: TaskStore, settings: Settings) -> None:
    await store.set_working(task_id)
    try:
        review_report = ReviewReport.model_validate(data["review_report"])
        config = ReviewerConfig(
            github_token=data["github_token"],
            model_id=data.get("model_id", settings.model_id),
            llm_base_url=settings.llm_base_url,
            max_agent_turns=settings.max_agent_turns,
        )
        agent = LeadEngineerAgent(config)
        result = await asyncio.to_thread(agent.evaluate, review_report)
        await store.set_completed(task_id, [A2ADataPart(data=result.model_dump())])
    except Exception as exc:
        await store.set_failed(task_id, sanitize_error(exc))


def lead_engineer_router(settings: Settings, store: TaskStore) -> APIRouter:
    router = APIRouter()

    @router.get("/.well-known/agent.json", response_model=AgentCard)
    async def get_agent_card() -> AgentCard:
        url = settings.resolve_agent_url(
            "lead-engineer", settings.agent_lead_engineer_url
        )
        return AgentCard(
            name="Lead Engineer",
            description="Evaluates reviewer findings and produces final accept/reject decisions for each issue.",
            url=url,
            skills=[
                AgentSkill(
                    id="evaluate_findings",
                    name="Evaluate Findings",
                    description="Triages and prioritises code review findings from the parallel review stage.",
                    inputSchema=LeadEngineerSkillInput.model_json_schema(),
                    outputSchema=LeadEngineerReport.model_json_schema(),
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
