"""Tests for the deterministic PRInfoCollector agent.

The collector retrieves factual PR data (title, body, labels, changed files)
directly from the GitHub MCP server via ``call_tool_sync`` -- no LLM tool loop
and no ``structured_output``.  Only the README summary uses an LLM.  These
tests therefore mock ``MCPClient.call_tool_sync`` and the summary ``Agent``.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from code_review_agent.agents.pr_info_collector import (
    GITHUB_MCP_URL,
    PRInfoCollector,
    SUMMARY_SYSTEM_PROMPT,
    _tool_text_blocks,
    is_dependency_file,
    is_target_file,
)
from code_review_agent.models.pr_info import PRInfoResult

_MOD = "code_review_agent.agents.pr_info_collector"


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


class TestIsDependencyFile:
    """Tests for the is_dependency_file helper."""

    @pytest.mark.parametrize(
        "path",
        [
            "package.json",
            "frontend/package.json",
            "package-lock.json",
            "yarn.lock",
            "pnpm-lock.yaml",
            "pyproject.toml",
            "requirements.txt",
            "poetry.lock",
            "Pipfile",
            "Pipfile.lock",
        ],
    )
    def test_dependency_files(self, path: str):
        assert is_dependency_file(path) is True

    @pytest.mark.parametrize(
        "path",
        ["src/index.ts", "README.md", "Makefile", "src/app.py"],
    )
    def test_non_dependency_files(self, path: str):
        assert is_dependency_file(path) is False


class TestToolTextBlocks:
    """Tests for the _tool_text_blocks MCP result parser."""

    def test_extracts_text_blocks(self):
        result = {
            "isError": False,
            "content": [{"text": "a"}, {"text": ""}, {"text": "b"}],
        }
        assert _tool_text_blocks(result) == ["a", "b"]

    def test_raises_on_tool_error(self):
        result = {"isError": True, "content": [{"text": "boom"}]}
        with pytest.raises(RuntimeError, match="boom"):
            _tool_text_blocks(result)


# ── Fixtures emulating GitHub MCP tool responses ────────────────────────────
_PR_GET = {
    "number": 48591,
    "title": "[progress] Show runtime errors only once",
    "body": "Fixes #48562",
    "labels": [{"name": "scope: progress"}],
    "state": "closed",
}
_PR_FILES = [
    {"filename": "src/index.ts", "patch": "@@ -1 +1 @@\n-a\n+b"},
    {"filename": "src/main.py", "patch": "@@ -1 +1 @@\n-x\n+y"},  # non-target
    {"filename": "package.json", "patch": "@@ -1 +1 @@\n-p\n+q"},  # dep + target
    {"filename": "requirements.txt", "patch": "@@ -1 +1 @@\n-r\n+s"},  # dep only
]
_README_BODY = "MyLib is a small utility library for widgets."


def _tool_result(payload_text: str, *, is_error: bool = False) -> dict:
    return {"isError": is_error, "content": [{"text": payload_text}]}


def _make_mcp(
    pr_get: dict | None = None,
    pr_files: list[dict] | None = None,
    readme_blocks: list[str] | None = None,
    readme_error: bool = False,
) -> MagicMock:
    """Build a mock MCP client whose call_tool_sync dispatches by arguments."""
    pr_get = _PR_GET if pr_get is None else pr_get
    pr_files = _PR_FILES if pr_files is None else pr_files
    if readme_blocks is None:
        readme_blocks = ["successfully downloaded text file", _README_BODY]

    def dispatch(tool_use_id, name, arguments):
        if name == "pull_request_read" and arguments["method"] == "get":
            return _tool_result(json.dumps(pr_get))
        if name == "pull_request_read" and arguments["method"] == "get_files":
            page = arguments.get("page", 1)
            batch = pr_files if page == 1 else []
            return _tool_result(json.dumps(batch))
        if name == "get_file_contents":
            if readme_error:
                return _tool_result("not found", is_error=True)
            return {
                "isError": False,
                "content": [{"text": t} for t in readme_blocks],
            }
        raise AssertionError(f"unexpected tool call: {name} {arguments}")

    mcp = MagicMock()
    mcp.call_tool_sync.side_effect = dispatch
    return mcp


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
    """Tests for the deterministic collect() method."""

    def _run(self, mcp: MagicMock, summary: str = "A summary.") -> PRInfoResult:
        collector = PRInfoCollector(github_token="tok", llm_base_url=None)
        mock_agent = MagicMock(return_value=summary)
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            return collector.collect("mui", "material-ui", 48591)

    def test_maps_pr_metadata_deterministically(self):
        result = self._run(_make_mcp())
        assert result.pr_info.title == "[progress] Show runtime errors only once"
        assert result.pr_info.pr_number == 48591
        assert result.pr_info.body == "Fixes #48562"
        assert result.pr_info.labels == ["scope: progress"]
        assert result.repository_info.owner == "mui"
        assert result.repository_info.repository == "material-ui"

    def test_file_changes_filtered_to_target_files(self):
        result = self._run(_make_mcp())
        paths = [fc.filePath for fc in result.pr_info.file_changes]
        # src/index.ts and package.json are targets; src/main.py and
        # requirements.txt are not review targets.
        assert paths == ["src/index.ts", "package.json"]
        assert result.pr_info.file_changes[0].patch == "@@ -1 +1 @@\n-a\n+b"

    def test_dependency_files_detected_from_changed_files(self):
        result = self._run(_make_mcp())
        assert result.dependency_files == ["package.json", "requirements.txt"]

    def test_no_hallucination_paths_are_verbatim_from_mcp(self):
        """Every returned path must come from the MCP get_files payload."""
        result = self._run(_make_mcp())
        mcp_paths = {f["filename"] for f in _PR_FILES}
        for fc in result.pr_info.file_changes:
            assert fc.filePath in mcp_paths

    def test_project_summary_from_single_llm_call(self):
        collector = PRInfoCollector(github_token="tok")
        mock_agent = MagicMock(return_value="MyLib summary.")
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=mock_agent) as agent_cls,
            patch(f"{_MOD}.OpenAIModel"),
        ):
            result = collector.collect("mui", "material-ui", 48591)

        assert result.project_summary == "MyLib summary."
        # Summary agent is constructed with the summary prompt and NO tools.
        kwargs = agent_cls.call_args.kwargs
        assert kwargs["system_prompt"] == SUMMARY_SYSTEM_PROMPT
        assert "tools" not in kwargs
        # The README body (last block) is what gets summarised.
        mock_agent.assert_called_once()
        assert _README_BODY in mock_agent.call_args.args[0]

    def test_empty_summary_when_readme_unavailable(self):
        result = self._run(_make_mcp(readme_error=True))
        assert result.project_summary == ""

    def test_starts_and_stops_mcp_client(self):
        mcp = _make_mcp()
        self._run(mcp)
        mcp.start.assert_called_once()
        mcp.stop.assert_called_once_with(None, None, None)

    def test_stops_mcp_client_even_when_read_raises(self):
        mcp = _make_mcp()
        mcp.call_tool_sync.side_effect = RuntimeError("boom")
        collector = PRInfoCollector(github_token="tok")
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=MagicMock()),
            patch(f"{_MOD}.OpenAIModel"),
            pytest.raises(RuntimeError, match="boom"),
        ):
            collector.collect("mui", "material-ui", 48591)
        mcp.stop.assert_called_once_with(None, None, None)

    def test_paginates_changed_files(self):
        """get_files is paged until a short page ends the loop."""
        page1 = [{"filename": f"src/f{i}.ts", "patch": "p"} for i in range(100)]
        page2 = [{"filename": "src/last.ts", "patch": "p"}]

        def dispatch(tool_use_id, name, arguments):
            if name == "pull_request_read" and arguments["method"] == "get":
                return _tool_result(json.dumps(_PR_GET))
            if name == "pull_request_read" and arguments["method"] == "get_files":
                batch = page1 if arguments["page"] == 1 else page2
                return _tool_result(json.dumps(batch))
            if name == "get_file_contents":
                return {"isError": False, "content": [{"text": _README_BODY}]}
            raise AssertionError(name)

        mcp = MagicMock()
        mcp.call_tool_sync.side_effect = dispatch
        result = self._run(mcp)
        assert len(result.pr_info.file_changes) == 101

    def test_returns_pr_info_result(self):
        result = self._run(_make_mcp())
        assert isinstance(result, PRInfoResult)

    def test_uses_create_github_mcp_client(self):
        collector = PRInfoCollector(
            github_token="mytoken", mcp_url="https://custom.example.com/mcp"
        )
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp) as factory,
            patch(f"{_MOD}.Agent", return_value=MagicMock(return_value="s")),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            collector.collect("mui", "material-ui", 48591)
        factory.assert_called_once_with("mytoken", "https://custom.example.com/mcp")

    def test_passes_llm_base_url_to_openai_model_when_set(self):
        collector = PRInfoCollector(
            github_token="tok", llm_base_url="http://localhost:11434/v1"
        )
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=MagicMock(return_value="s")),
            patch(f"{_MOD}.OpenAIModel") as model_cls,
        ):
            collector.collect("mui", "material-ui", 48591)
        model_cls.assert_called_once_with(
            model_id="gpt-4o", client_args={"base_url": "http://localhost:11434/v1"}
        )

    def test_omits_base_url_from_openai_model_when_not_set(self):
        collector = PRInfoCollector(github_token="tok")
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=MagicMock(return_value="s")),
            patch(f"{_MOD}.OpenAIModel") as model_cls,
        ):
            collector.collect("mui", "material-ui", 48591)
        model_cls.assert_called_once_with(model_id="gpt-4o")
