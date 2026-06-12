from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from code_review_agent.a2a.models import A2ADataPart, A2AMessage, A2ATextPart
from code_review_agent.api.agents.common import _extract_data, verify_github_token


class TestExtractData:
    def test_returns_data_from_data_part(self) -> None:
        msg = A2AMessage(
            role="user", parts=[A2ADataPart(data={"owner": "octocat", "pr_number": 1})]
        )
        result = _extract_data(msg)
        assert result == {"owner": "octocat", "pr_number": 1}

    def test_returns_empty_dict_when_only_text_parts(self) -> None:
        msg = A2AMessage(role="user", parts=[A2ATextPart(text="hello")])
        result = _extract_data(msg)
        assert result == {}

    def test_returns_first_data_part_when_multiple_parts(self) -> None:
        msg = A2AMessage(
            role="user",
            parts=[
                A2ATextPart(text="ignored"),
                A2ADataPart(data={"key": "value"}),
            ],
        )
        result = _extract_data(msg)
        assert result == {"key": "value"}

    def test_returns_empty_dict_for_empty_parts(self) -> None:
        msg = A2AMessage(role="user", parts=[])
        result = _extract_data(msg)
        assert result == {}


class TestVerifyGithubToken:
    @pytest.mark.asyncio
    async def test_returns_token_on_valid_response(self) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client = AsyncMock()
        mock_client.get.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch(
            "code_review_agent.api.agents.common.httpx.AsyncClient",
            return_value=mock_client,
        ):
            result = await verify_github_token("Bearer ghp_validtoken")

        assert result == "ghp_validtoken"

    @pytest.mark.asyncio
    async def test_raises_401_on_invalid_token(self) -> None:
        from fastapi import HTTPException

        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_client = AsyncMock()
        mock_client.get.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch(
            "code_review_agent.api.agents.common.httpx.AsyncClient",
            return_value=mock_client,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await verify_github_token("Bearer ghp_invalidtoken")

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_raises_401_on_missing_bearer_prefix(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await verify_github_token("ghp_nobearer")

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_raises_503_when_github_unreachable(self) -> None:
        from fastapi import HTTPException

        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.ConnectError("name resolution failed")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch(
            "code_review_agent.api.agents.common.httpx.AsyncClient",
            return_value=mock_client,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await verify_github_token("Bearer ghp_validtoken")

        assert exc_info.value.status_code == 503
