from fastapi import APIRouter

from code_review_agent.a2a.task_store import TaskStore
from code_review_agent.api.config import Settings


def svelte_reviewer_router(settings: Settings, store: TaskStore) -> APIRouter:
    raise NotImplementedError
