from typing import Any

import httpx
from fastapi import Header, HTTPException

from code_review_agent.a2a.models import A2ADataPart, A2AMessage


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
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid GitHub token")
    return token
