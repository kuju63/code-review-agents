"""Tests for shared exception types (agents/exceptions.py)."""

from strands.types.exceptions import ToolProviderException

from code_review_agent.agents.exceptions import INFRA_EXCEPTIONS


class TestInfraExceptions:
    def test_tool_provider_exception_is_infra_exception(self):
        assert ToolProviderException in INFRA_EXCEPTIONS
