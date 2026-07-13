"""Tests for the base reviewer agent."""

from unittest.mock import MagicMock, patch

import pytest
from strands.tools.mcp import MCPClient

from code_review_agent.agents.base_reviewer import (
    STRUCTURED_OUTPUT_DIRECTIVE,
    LLMReviewAgent,
    ReviewAgent,
    ReviewerConfig,
    _annotate_patch,
    compose_system_prompt,
)
from code_review_agent.agents.exceptions import StructuredOutputMissingError
from code_review_agent.skills.agent_skills_factory import AgentSkillType
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


class _SkillsReviewer(LLMReviewAgent):
    """Reviewer that uses AgentSkills via skill_type."""

    reviewer_id = "stub-skills"
    perspective = ReviewPerspective.TECHNICAL
    project_types = frozenset({ProjectType.REACT_TS})
    system_prompt = "Skills reviewer."
    skill_type = AgentSkillType.FRONTEND_REVIEW


def _make_context(shared_mcp_client: MagicMock | None = None) -> ReviewContext:
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
        ),
        shared_mcp_client=shared_mcp_client,
    )


def _mock_mcp() -> MagicMock:
    return MagicMock()


def _mock_shared_mcp() -> MagicMock:
    # spec=MCPClient so it satisfies ReviewContext.shared_mcp_client's
    # arbitrary_types_allowed isinstance check.
    return MagicMock(spec=MCPClient)


def _output() -> ReviewOutput:
    return ReviewOutput(summary="looks good", findings=[])


class TestReviewerConfig:
    def test_default_mcp_startup_retry_attempts_is_3(self):
        config = ReviewerConfig(github_token="tok")
        assert config.mcp_startup_retry_attempts == 3

    def test_default_mcp_startup_retry_backoff_seconds_is_1_0(self):
        config = ReviewerConfig(github_token="tok")
        assert config.mcp_startup_retry_backoff_seconds == 1.0

    def test_accepts_custom_retry_settings(self):
        config = ReviewerConfig(
            github_token="tok",
            mcp_startup_retry_attempts=5,
            mcp_startup_retry_backoff_seconds=2.5,
        )
        assert config.mcp_startup_retry_attempts == 5
        assert config.mcp_startup_retry_backoff_seconds == 2.5


class TestReviewerMetadata:
    """The base class exposes class-level metadata."""

    def test_subclass_is_review_agent(self):
        assert issubclass(_StubReviewer, ReviewAgent)

    def test_metadata_present(self):
        assert _StubReviewer.reviewer_id == "stub-technical"
        assert _StubReviewer.perspective is ReviewPerspective.TECHNICAL
        assert ProjectType.REACT_TS in _StubReviewer.project_types


class TestAnnotatePatch:
    """_annotate_patch adds file line numbers to unified diff lines."""

    def test_context_line_annotated_with_new_file_line(self):
        patch = "@@ -1,2 +1,2 @@\n context\n context2"
        lines = _annotate_patch(patch).splitlines()
        assert lines[1] == " L1:context"
        assert lines[2] == " L2:context2"

    def test_added_line_annotated_with_new_file_line(self):
        patch = "@@ -1,1 +1,2 @@\n context\n+added"
        lines = _annotate_patch(patch).splitlines()
        assert lines[1] == " L1:context"
        assert lines[2] == "+L2:added"

    def test_removed_line_annotated_with_old_file_line(self):
        patch = "@@ -5,2 +5,1 @@\n context\n-removed"
        lines = _annotate_patch(patch).splitlines()
        assert lines[1] == " L5:context"
        assert lines[2] == "-L6:removed"

    def test_removal_does_not_increment_new_line_counter(self):
        patch = "@@ -1,3 +1,2 @@\n ctx\n-removed\n ctx2"
        lines = _annotate_patch(patch).splitlines()
        # ctx  → L1 (new), removed → old L2, ctx2 → L2 (new, unchanged)
        assert lines[1] == " L1:ctx"
        assert lines[2] == "-L2:removed"
        assert lines[3] == " L2:ctx2"

    def test_addition_does_not_increment_old_line_counter(self):
        patch = "@@ -1,2 +1,3 @@\n ctx\n+added\n ctx2"
        lines = _annotate_patch(patch).splitlines()
        assert lines[1] == " L1:ctx"
        assert lines[2] == "+L2:added"
        assert lines[3] == " L3:ctx2"

    def test_hunk_header_preserved_verbatim(self):
        patch = "@@ -10,3 +10,3 @@\n line"
        lines = _annotate_patch(patch).splitlines()
        assert lines[0] == "@@ -10,3 +10,3 @@"

    def test_hunk_header_with_trailing_context(self):
        patch = "@@ -10,2 +10,2 @@ function foo() {\n line"
        lines = _annotate_patch(patch).splitlines()
        assert lines[0].startswith("@@ -10,2 +10,2 @@")
        assert lines[1] == " L10:line"

    def test_multiple_hunks_reset_line_counters(self):
        patch = "@@ -1,1 +1,1 @@\n line1\n@@ -10,1 +10,1 @@\n line10"
        lines = _annotate_patch(patch).splitlines()
        assert lines[1] == " L1:line1"
        assert lines[2] == "@@ -10,1 +10,1 @@"
        assert lines[3] == " L10:line10"

    def test_no_newline_marker_passed_through(self):
        patch = "@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file"
        result = _annotate_patch(patch)
        assert "\\ No newline at end of file" in result

    def test_empty_patch_returns_empty_string(self):
        assert _annotate_patch("") == ""

    def test_hunk_without_count_suffix(self):
        # @@ -1 +1 @@ is valid (count omitted when it equals 1)
        patch = "@@ -1 +1 @@\n-a\n+b"
        lines = _annotate_patch(patch).splitlines()
        assert lines[1] == "-L1:a"
        assert lines[2] == "+L1:b"


class TestBuildPrompt:
    """_build_prompt serialises the relevant PR info."""

    def test_prompt_contains_pr_details(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        prompt = reviewer._build_prompt(_make_context())
        assert "octocat/hello" in prompt
        assert "A sample project." in prompt
        assert "src/App.tsx" in prompt
        assert "package.json" in prompt

    def test_prompt_annotates_patch_lines(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        prompt = reviewer._build_prompt(_make_context())
        # _make_context has patch "@@ -1 +1 @@\n-a\n+b"
        assert "-L1:a" in prompt
        assert "+L1:b" in prompt

    def test_prompt_includes_annotation_key(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        prompt = reviewer._build_prompt(_make_context())
        assert "+L{N}" in prompt or "L{N}" in prompt


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

        mock_factory.assert_called_once_with(
            "tok",
            reviewer._config.mcp_url,
            retry_attempts=reviewer._config.mcp_startup_retry_attempts,
            retry_backoff_seconds=reviewer._config.mcp_startup_retry_backoff_seconds,
        )
        mock_agent.cleanup.assert_called_once_with()

        call_kwargs = mock_agent_cls.call_args.kwargs
        # review() appends the shared structured-output directive to the
        # reviewer's role prompt, so the Agent sees the composed prompt.
        assert call_kwargs["system_prompt"] == compose_system_prompt(
            "You are a stub reviewer."
        )
        assert STRUCTURED_OUTPUT_DIRECTIVE in call_kwargs["system_prompt"]
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

        mock_agent.cleanup.assert_called_once_with()

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

    def test_raises_structured_output_missing_error_when_none(self):
        """Strands returns ``structured_output=None`` without raising when the
        model exhausts its turn limit without ever satisfying the schema
        (see strands.agent.Agent.__call__ docs on ``stop_reason``). review()
        must surface this as an actionable error instead of letting a
        downstream attribute access fail with an opaque AttributeError."""
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = None
        mock_agent.return_value.stop_reason = "limit_turns"

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            with pytest.raises(StructuredOutputMissingError, match="stub-technical"):
                reviewer.review(_make_context())

        mock_agent.cleanup.assert_called_once_with()

    def test_review_propagates_agent_construction_error_without_unbound_local(self):
        """If Agent(...) itself raises, review() must propagate that error
        cleanly instead of an UnboundLocalError from an unset ``agent`` in
        the finally block's cleanup call."""
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", side_effect=RuntimeError("construction boom")),
        ):
            with pytest.raises(RuntimeError, match="construction boom"):
                reviewer.review(_make_context())

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

    def test_agent_called_with_default_limits(self):
        """agent() receives limits={"turns": 30} by default."""
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            reviewer.review(_make_context())

        _, kwargs = mock_agent.call_args
        assert kwargs.get("limits") == {"turns": 30}

    def test_agent_called_with_custom_max_agent_turns(self):
        """Custom max_agent_turns is forwarded to the limits dict."""
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok", max_agent_turns=10))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            reviewer.review(_make_context())

        _, kwargs = mock_agent.call_args
        assert kwargs.get("limits") == {"turns": 10}

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
            model_id="gpt-4o",
            client_args={"base_url": "http://localhost:11434/v1"},
            params={"temperature": 0.1},
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


class TestReviewWithSharedMcpClient:
    """review() must prefer context.shared_mcp_client over creating its own
    client, per spec §4.2/§4.4 -- the shared connection is the whole point
    of the parallel-review-stage session sharing."""

    def test_uses_shared_client_when_present(self):
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        shared_mcp = _mock_shared_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client") as mock_factory,
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context(shared_mcp_client=shared_mcp))

        mock_factory.assert_not_called()
        assert mock_agent_cls.call_args.kwargs["tools"] == [shared_mcp]

    def test_falls_back_to_own_client_when_shared_absent(self):
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
            reviewer.review(_make_context(shared_mcp_client=None))

        mock_factory.assert_called_once_with(
            "tok",
            reviewer._config.mcp_url,
            retry_attempts=reviewer._config.mcp_startup_retry_attempts,
            retry_backoff_seconds=reviewer._config.mcp_startup_retry_backoff_seconds,
        )
        assert mock_agent_cls.call_args.kwargs["tools"] == [mock_mcp]

    def test_no_mcp_reviewer_ignores_shared_client(self):
        reviewer = _NoMcpReviewer(ReviewerConfig(github_token="tok"))
        shared_mcp = _mock_shared_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client") as mock_factory,
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context(shared_mcp_client=shared_mcp))

        mock_factory.assert_not_called()
        assert mock_agent_cls.call_args.kwargs["tools"] == []

    def test_shared_client_cleanup_uses_agent_cleanup_not_stop(self):
        """Reviewers must never call stop() directly on a shared client --
        that would tear down the connection out from under other reviewers
        still using it (spec §4.3). Only agent.cleanup() (reference-count
        release) is permitted."""
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        shared_mcp = _mock_shared_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client"),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            reviewer.review(_make_context(shared_mcp_client=shared_mcp))

        shared_mcp.stop.assert_not_called()
        mock_agent.cleanup.assert_called_once_with()


class TestURLFetchReviewer:
    """Tests for the uses_url_fetch × uses_github_mcp tool combinations."""

    def test_url_fetch_and_mcp_reviewer_receives_both_tools(self):
        """Reviewer with uses_url_fetch=True and uses_github_mcp=True should
        pass [mcp_client, http_request] to the Agent."""
        from strands_tools import http_request

        reviewer = _UrlFetchReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context())

        tools = mock_agent_cls.call_args.kwargs["tools"]
        assert mock_mcp in tools
        assert http_request in tools

    def test_url_fetch_only_reviewer_skips_mcp(self):
        """Reviewer with uses_url_fetch=True and uses_github_mcp=False should
        receive only http_request (no MCP client)."""
        from strands_tools import http_request

        reviewer = _UrlFetchOnlyReviewer(ReviewerConfig(github_token="tok"))
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client") as mock_mcp_factory,
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context())

        mock_mcp_factory.assert_not_called()
        tools = mock_agent_cls.call_args.kwargs["tools"]
        assert tools == [http_request]

    def test_url_fetch_reviewer_adds_http_request(self):
        """uses_url_fetch=True must add the http_request tool from strands_tools."""
        from strands_tools import http_request

        reviewer = _UrlFetchOnlyReviewer(ReviewerConfig(github_token="tok"))
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client"),
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context())

        tools = mock_agent_cls.call_args.kwargs["tools"]
        assert http_request in tools

    def test_mcp_still_stopped_when_url_fetch_also_enabled(self):
        """MCP cleanup must still run in finally even when url_fetch is also active."""
        reviewer = _UrlFetchReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.side_effect = RuntimeError("boom")

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
        ):
            with pytest.raises(RuntimeError, match="boom"):
                reviewer.review(_make_context())

        mock_agent.cleanup.assert_called_once_with()


class TestAgentSkillsIntegration:
    """Tests for skill_type-driven AgentSkills integration."""

    def test_none_skill_type_adds_no_plugins(self):
        """skill_type=NONE must not add file_read or any plugin."""
        reviewer = _StubReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
        ):
            reviewer.review(_make_context())

        call_kwargs = mock_agent_cls.call_args.kwargs
        assert call_kwargs["plugins"] == []
        from strands_tools import file_read

        assert file_read not in call_kwargs["tools"]

    def test_skill_type_adds_file_read_tool(self):
        """skill_type != NONE must add file_read to the tools list."""
        from strands_tools import file_read

        reviewer = _SkillsReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
            patch(f"{_BASE}.create_agent_skills", return_value=MagicMock()),
        ):
            reviewer.review(_make_context())

        tools = mock_agent_cls.call_args.kwargs["tools"]
        assert file_read in tools

    def test_skill_type_calls_create_agent_skills(self):
        """skill_type != NONE must delegate to create_agent_skills()."""
        reviewer = _SkillsReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()
        mock_skills = MagicMock()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent),
            patch(
                f"{_BASE}.create_agent_skills", return_value=mock_skills
            ) as mock_factory,
        ):
            reviewer.review(_make_context())

        mock_factory.assert_called_once_with(AgentSkillType.FRONTEND_REVIEW)

    def test_skill_type_adds_agent_skills_to_plugins(self):
        """create_agent_skills() return value must appear in Agent plugins."""
        reviewer = _SkillsReviewer(ReviewerConfig(github_token="tok"))
        mock_mcp = _mock_mcp()
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = _output()
        mock_skills = MagicMock()

        with (
            patch(f"{_BASE}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_BASE}.Agent", return_value=mock_agent) as mock_agent_cls,
            patch(f"{_BASE}.create_agent_skills", return_value=mock_skills),
        ):
            reviewer.review(_make_context())

        plugins = mock_agent_cls.call_args.kwargs["plugins"]
        assert mock_skills in plugins
