"""Tests for the base reviewer agent."""

from unittest.mock import MagicMock, patch

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
    mock_mcp = MagicMock()
    mock_mcp.__enter__ = MagicMock(return_value=mock_mcp)
    mock_mcp.__exit__ = MagicMock(return_value=False)
    return mock_mcp


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

    def test_opens_mcp_and_calls_structured_output(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.structured_output.return_value = _output()

        with (
            patch(
                f"{_BASE}.create_github_mcp_client", return_value=mock_mcp
            ) as mock_factory,
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context())

        mock_factory.assert_called_once_with("tok", reviewer._config.mcp_url)
        mock_mcp.__enter__.assert_called_once()
        mock_mcp.__exit__.assert_called_once()

        call_kwargs = mock_agent_cls.call_args.kwargs
        assert call_kwargs["system_prompt"] == "You are a stub reviewer."
        assert call_kwargs["tools"] == [mock_mcp]

        args, kwargs = mock_agent.structured_output.call_args
        assert args[0] is ReviewOutput
        assert "octocat/hello" in kwargs["prompt"]

    def test_wraps_output_with_metadata(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.structured_output.return_value = _output()

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
        mock_agent.structured_output.return_value = _output()

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
        mock_agent.structured_output.return_value = _output()

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
        mock_agent.structured_output.return_value = _output()

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
        mock_agent.structured_output.return_value = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
            patch(f"{_BASE}.OpenAIModel") as mock_model_cls,
        ):
            reviewer.review(_make_context())

        mock_model_cls.assert_called_once_with(model_id="gpt-4o")
