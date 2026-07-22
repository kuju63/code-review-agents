from typing import Any

import httpx
from fastapi import Header, HTTPException
from pydantic import BaseModel, Field

from code_review_agent.a2a.models import A2ADataPart, A2AMessage
from code_review_agent.models.pr_info import PRInfoResult
from code_review_agent.models.review import ReviewReport


class ReviewerSkillInput(BaseModel):
    """Input payload schema for reviewer skills (Frontend / Svelte / Security).

    Defined as a Pydantic model so the AgentCard can advertise a fully
    self-contained JSON Schema (``$defs``-based) via ``model_json_schema()``
    instead of a dangling cross-document ``$ref``.
    """

    pr_info: PRInfoResult = Field(..., description="Collected PR information")
    model_id: str = Field(default="gpt-4o", description="OpenAI-compatible model ID")


class LeadEngineerSkillInput(BaseModel):
    """Input payload schema for the Lead Engineer skill."""

    review_report: ReviewReport = Field(
        ..., description="Aggregated parallel-review output"
    )
    model_id: str = Field(default="gpt-4o", description="OpenAI-compatible model ID")


def _extract_data(message: A2AMessage) -> dict[str, Any]:
    for part in message.parts:
        if isinstance(part, A2ADataPart):
            return dict(part.data)
    return {}


async def verify_github_token(
    authorization: str = Header(..., description="Bearer <github_oauth_token>"),
) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authorization header must be 'Bearer <token>'",
        )
    token = authorization.removeprefix("Bearer ")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0,
            )
    except httpx.HTTPError as exc:
        # GitHub temporarily unreachable (DNS / TLS / timeout / connection).
        # This dependency runs on every task submission, so return a controlled
        # 503 instead of letting the failure surface as an opaque 500.
        raise HTTPException(
            status_code=503,
            detail="GitHub authentication endpoint is temporarily unreachable",
        ) from exc
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid GitHub token")
    return token
