"""Tests for PRInfoCollector agent."""

from unittest.mock import MagicMock, patch

import pytest

from code_review_agent.agents.pr_info_collector import (
    PRInfoCollector,
    _COLLECT_PROMPT_TEMPLATE,
    GITHUB_MCP_URL,
    SYSTEM_PROMPT,
    is_target_file,
)
from code_review_agent.models.pr_info import (
    FileChange,
    PRInfo,
    PRInfoResult,
    RepositoryInfo,
)


class TestIsTargetFile:
    """Tests for the is_target_file helper."""

    @pytest.mark.parametrize(
        "path",
        [
            "src/index.ts",
            "src/App.tsx",
            "lib/utils.js",
            "components/Button.jsx",
            "styles/main.css",
            "styles/theme.scss",
            "index.html",
            "package.json",
            "src/nested/package.json",
        ],
    )
    def test_included_files(self, path: str):
        assert is_target_file(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "src/main.py",
            "README.md",
            "Makefile",
            "docker-compose.yml",
            "src/utils.go",
            ".env",
            "package-lock.json",
            "yarn.lock",
        ],
    )
    def test_excluded_files(self, path: str):
        assert is_target_file(path) is False


class TestSystemPrompt:
    """The SYSTEM_PROMPT must instruct the model to retrieve the changed-file
    list via a tool and emit it as a per-file array, not a count summary.

    This guards against the secondary failure observed in the gemma-4-e4b
    measurement where file_changes collapsed into an aggregate object
    (e.g. ``changed_files_count``) instead of one entry per file.
    """

    def test_prompt_requires_tool_use(self):
        assert "tool" in SYSTEM_PROMPT.lower()

    def test_prompt_requires_file_list_as_array(self):
        lowered = SYSTEM_PROMPT.lower()
        # Must mention listing/array of changed files and forbid count summaries.
        assert "array" in lowered or "one entry per file" in lowered
        assert "count" in lowered or "summar" in lowered


class TestPRInfoCollectorInit:
    """Tests for PRInfoCollector initialisation."""

    def test_default_values(self):
        collector = PRInfoCollector(github_token="token123")
        assert collector._github_token == "token123"
        assert collector._model_id == "gpt-4o"
        assert collector._mcp_url == GITHUB_MCP_URL

    def test_custom_values(self):
        collector = PRInfoCollector(
            github_token="tok",
            model_id="gpt-4o-mini",
            mcp_url="https://custom.example.com/mcp",
        )
        assert collector._model_id == "gpt-4o-mini"
        assert collector._mcp_url == "https://custom.example.com/mcp"


class TestPRInfoCollectorCollect:
    """Tests for the collect() method."""

    def _make_result(
        self,
        file_changes: list[FileChange] | None = None,
    ) -> PRInfoResult:
        if file_changes is None:
            file_changes = [
                FileChange(filePath="src/index.ts", patch="@@ -1 +1 @@\n-a\n+b")
            ]
        return PRInfoResult(
            repository_info=RepositoryInfo(owner="octocat", repository="hello"),
            project_summary="Hello world project.",
            pr_info=PRInfo(
                title="Fix",
                pr_number=1,
                body="Fixes a bug",
                labels=["bug"],
                file_changes=file_changes,
            ),
            dependency_files=["package.json"],
        )

    def _mock_mcp(self) -> MagicMock:
        return MagicMock()

    def test_collect_calls_agent_with_correct_prompt(self):
        expected_result = self._make_result()
        collector = PRInfoCollector(github_token="tok")
        mock_mcp = self._mock_mcp()
        mock_agent_instance = MagicMock()
        mock_agent_instance.structured_output.return_value = expected_result

        with (
            patch(
                "code_review_agent.agents.pr_info_collector.create_github_mcp_client",
                return_value=mock_mcp,
            ),
            patch(
                "code_review_agent.agents.pr_info_collector.Agent",
                return_value=mock_agent_instance,
            ) as mock_agent_cls,
        ):
            result = collector.collect("octocat", "hello", 1)

        mock_agent_cls.assert_called_once()
        call_kwargs = mock_agent_cls.call_args.kwargs
        assert call_kwargs["system_prompt"] == SYSTEM_PROMPT
        assert call_kwargs["tools"] == [mock_mcp]

        expected_prompt = _COLLECT_PROMPT_TEMPLATE.format(
            owner="octocat", repo="hello", pr_number=1
        )
        # 案A: first the agent is invoked with the prompt to run the tool loop
        # (toolUse against GitHub MCP), then structured_output is called WITHOUT
        # a prompt so it structures the conversation context (the fetched data).
        mock_agent_instance.assert_called_once_with(expected_prompt)
        mock_agent_instance.structured_output.assert_called_once_with(PRInfoResult)

        assert result.repository_info.owner == "octocat"

    def test_collect_stops_mcp_client(self):
        """The Agent owns the MCP client lifecycle; collect() must stop it.

        In strands >=1.41 the client is started by the Agent while loading
        tools, so collect() no longer opens it via ``with``.  It must instead
        call ``stop()`` deterministically once the agent run completes.
        """
        collector = PRInfoCollector(github_token="tok")
        mock_mcp = self._mock_mcp()
        mock_agent_instance = MagicMock()
        mock_agent_instance.structured_output.return_value = self._make_result()

        with (
            patch(
                "code_review_agent.agents.pr_info_collector.create_github_mcp_client",
                return_value=mock_mcp,
            ),
            patch(
                "code_review_agent.agents.pr_info_collector.Agent",
                return_value=mock_agent_instance,
            ),
        ):
            collector.collect("octocat", "hello", 1)

        mock_mcp.stop.assert_called_once_with(None, None, None)

    def test_collect_stops_mcp_client_even_when_agent_raises(self):
        """``stop()`` must run even if the agent run fails (finally cleanup)."""
        collector = PRInfoCollector(github_token="tok")
        mock_mcp = self._mock_mcp()
        mock_agent_instance = MagicMock()
        mock_agent_instance.structured_output.side_effect = RuntimeError("boom")

        with (
            patch(
                "code_review_agent.agents.pr_info_collector.create_github_mcp_client",
                return_value=mock_mcp,
            ),
            patch(
                "code_review_agent.agents.pr_info_collector.Agent",
                return_value=mock_agent_instance,
            ),
        ):
            with pytest.raises(RuntimeError, match="boom"):
                collector.collect("octocat", "hello", 1)

        mock_mcp.stop.assert_called_once_with(None, None, None)

    def test_collect_returns_pr_info_result(self):
        collector = PRInfoCollector(github_token="tok")
        mock_mcp = self._mock_mcp()
        mock_agent_instance = MagicMock()
        mock_agent_instance.structured_output.return_value = self._make_result()

        with (
            patch(
                "code_review_agent.agents.pr_info_collector.create_github_mcp_client",
                return_value=mock_mcp,
            ),
            patch(
                "code_review_agent.agents.pr_info_collector.Agent",
                return_value=mock_agent_instance,
            ),
        ):
            result = collector.collect("octocat", "hello", 1)

        assert isinstance(result, PRInfoResult)
        assert result.repository_info.owner == "octocat"

    def test_collect_filters_non_target_files(self):
        """Non-target files returned by the LLM must be stripped from result."""
        raw_changes = [
            FileChange(filePath="src/index.ts", patch="@@ -1 +1 @@\n-a\n+b"),
            FileChange(filePath="src/main.py", patch="@@ -1 +1 @@\n-x\n+y"),
            FileChange(filePath="README.md", patch="@@ -1 +1 @@\n-r\n+s"),
        ]
        collector = PRInfoCollector(github_token="tok")
        mock_mcp = self._mock_mcp()
        mock_agent_instance = MagicMock()
        mock_agent_instance.structured_output.return_value = self._make_result(
            file_changes=raw_changes
        )

        with (
            patch(
                "code_review_agent.agents.pr_info_collector.create_github_mcp_client",
                return_value=mock_mcp,
            ),
            patch(
                "code_review_agent.agents.pr_info_collector.Agent",
                return_value=mock_agent_instance,
            ),
        ):
            result = collector.collect("octocat", "hello", 1)

        assert len(result.pr_info.file_changes) == 1
        assert result.pr_info.file_changes[0].filePath == "src/index.ts"

    def test_collect_uses_create_github_mcp_client(self):
        """collect() must delegate MCP client creation to create_github_mcp_client."""
        collector = PRInfoCollector(
            github_token="mytoken", mcp_url="https://custom.example.com/mcp"
        )
        mock_mcp = self._mock_mcp()
        mock_agent_instance = MagicMock()
        mock_agent_instance.structured_output.return_value = self._make_result()

        with (
            patch(
                "code_review_agent.agents.pr_info_collector.create_github_mcp_client",
                return_value=mock_mcp,
            ) as mock_factory,
            patch(
                "code_review_agent.agents.pr_info_collector.Agent",
                return_value=mock_agent_instance,
            ),
        ):
            collector.collect("octocat", "hello", 1)

        mock_factory.assert_called_once_with(
            "mytoken", "https://custom.example.com/mcp"
        )

    def test_passes_llm_base_url_to_openai_model_when_set(self):
        collector = PRInfoCollector(
            github_token="tok", llm_base_url="http://localhost:11434/v1"
        )
        mock_mcp = self._mock_mcp()
        mock_agent_instance = MagicMock()
        mock_agent_instance.structured_output.return_value = self._make_result()
        _MOD = "code_review_agent.agents.pr_info_collector"

        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_MOD}.Agent", return_value=mock_agent_instance),
            patch(f"{_MOD}.OpenAIModel") as mock_model_cls,
        ):
            collector.collect("octocat", "hello", 1)

        mock_model_cls.assert_called_once_with(
            model_id="gpt-4o", client_args={"base_url": "http://localhost:11434/v1"}
        )

    def test_omits_base_url_from_openai_model_when_not_set(self):
        collector = PRInfoCollector(github_token="tok")
        mock_mcp = self._mock_mcp()
        mock_agent_instance = MagicMock()
        mock_agent_instance.structured_output.return_value = self._make_result()
        _MOD = "code_review_agent.agents.pr_info_collector"

        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mock_mcp),
            patch(f"{_MOD}.Agent", return_value=mock_agent_instance),
            patch(f"{_MOD}.OpenAIModel") as mock_model_cls,
        ):
            collector.collect("octocat", "hello", 1)

        mock_model_cls.assert_called_once_with(model_id="gpt-4o")
