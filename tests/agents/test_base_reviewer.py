"""Tests for the base reviewer agent."""

from unittest.mock import MagicMock, patch

import pytest

from code_review_agent.agents.base_reviewer import (
    LLMReviewAgent,
    ReviewAgent,
    ReviewerConfig,
)
from code_review_agent.models.pr_info import (
    FileChange,
    PRInfo,
    PRInfoResult,
    RepositoryInfo,
)
from code_review_agent.models.review import (
    ProjectType,
    ReviewContext,
    ReviewOutput,
    ReviewPerspective,
    ReviewResult,
)

_BASE = "code_review_agent.agents.base_reviewer"


class _StubReviewer(LLMReviewAgent):
    """Concrete reviewer used to exercise the base implementation."""

    reviewer_id = "stub-technical"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = "You are a stub reviewer."


class _NoMcpReviewer(LLMReviewAgent):
    """Reviewer that does not use GitHub MCP."""

    reviewer_id = "stub-nomcp"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = "No MCP."
    uses_github_mcp = False


class _UrlFetchReviewer(LLMReviewAgent):
    """Reviewer that uses both GitHub MCP and URL fetch."""

    reviewer_id = "stub-urlfetch"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = "URL fetch + MCP."
    uses_github_mcp = True
    uses_url_fetch = True


class _UrlFetchOnlyReviewer(LLMReviewAgent):
    """Reviewer that uses URL fetch but not GitHub MCP."""

    reviewer_id = "stub-urlfetchonly"
    perspective = ReviewPerspective.SECURITY
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = "URL fetch only."
    uses_github_mcp = False
    uses_url_fetch = True


def _make_context() -> ReviewContext:
    return ReviewContext(
        pr_info=PRInfoResult(
            repository_info=RepositoryInfo(owner="octocat", repository="hello"),
            project_summary="A sample project.",
            pr_info=PRInfo(
                title="Add button",
                pr_number=7,
                body="adds a button",
                labels=["feature"],
                file_changes=[
                    FileChange(filePath="src/App.tsx", patch="@@ -1 +1 @@\n-a\n+b")
                ],
            ),
            dependency_files=["package.json"],
        )
    )


def _mock_mcp() -> MagicMock:
    return MagicMock()


def _output() -> ReviewOutput:
    return ReviewOutput(summary="looks good", findings=[])


class TestReviewerMetadata:
    """The base class exposes class-level metadata."""

    def test_subclass_is_review_agent(self):
        assert issubclass(_StubReviewer, ReviewAgent)

    def test_metadata_present(self):
        assert _StubReviewer.reviewer_id == "stub-technical"
        assert _StubReviewer.perspective is ReviewPerspective.TECHNICAL
        assert ProjectType.REACT_TS in _StubReviewer.project_types


class TestBuildPrompt:
    """_build_prompt serialises the relevant PR info."""

    def test_prompt_contains_pr_details(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        prompt = reviewer._build_prompt(_make_context())
        assert "octocat/hello" in prompt
        assert "A sample project." in prompt
        assert "src/App.tsx" in prompt
        assert "package.json" in prompt


class TestReview:
    """review() runs the agent and wraps the output with metadata."""

    def test_loads_mcp_as_tool_and_stops_it(self):
        """The Agent starts the MCP client while loading tools; review() must
        hand it over as a tool and stop it deterministically afterwards."""
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(
                f"{_BASE}.create_github_mcp_client", return_value=mock_mcp
            ) as mock_factory,
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context())

        mock_factory.assert_called_once_with("tok", reviewer._config.mcp_url)
        mock_mcp.stop.assert_called_once_with(None, None, None)

        call_kwargs = mock_agent_cls.call_args.kwargs
        assert call_kwargs["system_prompt"] == "You are a stub reviewer."
        assert call_kwargs["tools"] == [mock_mcp]

    def test_stops_mcp_even_when_agent_raises(self):
        """``stop()`` must run even if the agent run fails (finally cleanup)."""
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.side_effect = RuntimeError("boom")

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            with pytest.raises(RuntimeError, match="boom"):
                reviewer.review(_make_context())

        mock_mcp.stop.assert_called_once_with(None, None, None)

        args, kwargs = mock_agent.call_args
        assert "octocat/hello" in args[0]
        assert kwargs.get("structured_output_model") is ReviewOutput

    def test_wraps_output_with_metadata(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            result = reviewer.review(_make_context(), project_type=ProjectType.REACT_TS)

        assert isinstance(result, ReviewResult)
        assert result.reviewer_id == "stub-technical"
        assert result.perspective is ReviewPerspective.TECHNICAL
        assert result.project_type is ProjectType.REACT_TS
        assert result.output.summary == "looks good"

    def test_no_mcp_reviewer_skips_mcp_client(self):
        reviewer = _NoMcpReviewer(ReviewerConfig(github_token="tok"))
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client") as mock_factory,
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            result = reviewer.review(_make_context())

        mock_factory.assert_not_called()
        assert mock_agent_cls.call_args.kwargs["tools"] == []
        assert result.reviewer_id == "stub-nomcp"

    def test_uses_configured_model_id(self):
        reviewer = _StubReviewer(
            ReviewerConfig(github_token="tok", model_id="gpt-4o-mini")
        )
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
            patch(f"{_BASE}.OpenAIModel") as mock_model_cls,
        ):
            reviewer.review(_make_context())

        mock_model_cls.assert_called_once_with(model_id="gpt-4o-mini")

    def test_passes_llm_base_url_to_openai_model_when_set(self):
        reviewer = _StubReviewer(
            ReviewerConfig(
                github_token="tok",
                model_id="gpt-4o",
                llm_base_url="http://localhost:11434/v1",
            )
        )
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
            patch(f"{_BASE}.OpenAIModel") as mock_model_cls,
        ):
            reviewer.review(_make_context())

        mock_model_cls.assert_called_once_with(
            model_id="gpt-4o", client_args={"base_url": "http://localhost:11434/v1"}
        )

    def test_omits_base_url_from_openai_model_when_not_set(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok", model_id="gpt-4o"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
            patch(f"{_BASE}.OpenAIModel") as mock_model_cls,
        ):
            reviewer.review(_make_context())

        mock_model_cls.assert_called_once_with(model_id="gpt-4o")


class TestURLFetchReviewer:
    """Tests for the uses_url_fetch × uses_github_mcp tool combinations."""

    def test_url_fetch_and_mcp_reviewer_receives_both_tools(self):
        """Reviewer with uses_url_fetch=True and uses_github_mcp=True should
        pass [mcp_client, url_fetch_tool] to the Agent."""
        reviewer = _UrlFetchReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_url_fetch = MagicMock()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.create_url_fetch_tool", return_value=mock_url_fetch),
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context())

        tools = mock_agent_cls.call_args.kwargs["tools"]
        assert mock_mcp in tools
        assert mock_url_fetch in tools

    def test_url_fetch_only_reviewer_skips_mcp(self):
        """Reviewer with uses_url_fetch=True and uses_github_mcp=False should
        receive only the url_fetch_tool (no MCP client)."""
        reviewer = _UrlFetchOnlyReviewer(ReviewerConfig(github_token="tok"))
        mock_url_fetch = MagicMock()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client") as mock_mcp_factory,
            patch(f"{_BASE}.create_url_fetch_tool", return_value=mock_url_fetch),
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context())

        mock_mcp_factory.assert_not_called()
        tools = mock_agent_cls.call_args.kwargs["tools"]
        assert tools == [mock_url_fetch]

    def test_url_fetch_config_propagates_model_settings(self):
        """URLFetchConfig passed to create_url_fetch_tool must inherit
        model_id and llm_base_url from ReviewerConfig."""
        reviewer = _UrlFetchOnlyReviewer(
            ReviewerConfig(
                github_token="tok",
                model_id="gpt-4o-mini",
                llm_base_url="http://localhost:11434/v1",
            )
        )
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client"),
            patch(f"{_BASE}.create_url_fetch_tool") as mock_factory,
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            reviewer.review(_make_context())

        call_config = mock_factory.call_args.args[0]
        assert call_config.model_id == "gpt-4o-mini"
        assert call_config.llm_base_url == "http://localhost:11434/v1"

    def test_mcp_still_stopped_when_url_fetch_also_enabled(self):
        """MCP cleanup must still run in finally even when url_fetch is also active."""
        reviewer = _UrlFetchReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.side_effect = RuntimeError("boom")

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.create_url_fetch_tool", return_value=MagicMock()),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            with pytest.raises(RuntimeError, match="boom"):
                reviewer.review(_make_context())

        mock_mcp.stop.assert_called_once_with(None, None, None)
