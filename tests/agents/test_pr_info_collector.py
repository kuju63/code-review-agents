"""Tests for the deterministic PRInfoCollector agent.

The collector retrieves factual PR data (title, body, labels, changed files)
directly from the GitHub MCP server via ``call_tool_sync`` -- no LLM tool loop
and no ``structured_output``.  Only the README summary uses an LLM.  These
tests therefore mock ``MCPClient.call_tool_sync`` and the summary ``Agent``.
"""

import json
import logging
import os
from unittest.mock import MagicMock, patch

import pytest
from httpx import ConnectError
from strands.types.exceptions import EventLoopException

from code_review_agent.agents.pr_info_collector import (
    GITHUB_MCP_URL,
    PRInfoCollector,
    SUMMARY_SYSTEM_PROMPT,
    _extract_label_names,
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


class TestExtractLabelNames:
    """Tests for _extract_label_names (handles string and dict label shapes)."""

    def test_string_labels(self):
        assert _extract_label_names(["scope: progress", "bug"]) == [
            "scope: progress",
            "bug",
        ]

    def test_dict_labels(self):
        assert _extract_label_names([{"name": "bug"}, {"name": "feat"}]) == [
            "bug",
            "feat",
        ]

    def test_mixed_and_empty(self):
        assert _extract_label_names(["a", {"name": "b"}, {}, None]) == ["a", "b"]
        assert _extract_label_names([]) == []
        assert _extract_label_names(None) == []


class TestExtractHeadRef:
    """Tests for _extract_head_ref."""

    def test_prefers_sha(self):
        from code_review_agent.agents.pr_info_collector import _extract_head_ref

        assert _extract_head_ref({"head": {"sha": "abc", "ref": "br"}}) == "abc"

    def test_falls_back_to_ref(self):
        from code_review_agent.agents.pr_info_collector import _extract_head_ref

        assert _extract_head_ref({"head": {"ref": "br"}}) == "br"

    def test_none_when_absent(self):
        from code_review_agent.agents.pr_info_collector import _extract_head_ref

        assert _extract_head_ref({}) is None
        assert _extract_head_ref({"head": None}) is None


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
    # GitHub MCP ``get`` returns labels as plain strings, not {"name": ...}.
    "labels": ["scope: progress"],
    "state": "closed",
    "head": {"sha": "headsha123", "ref": "feature-branch"},
}
_PR_FILES = [
    {"filename": "src/index.ts", "patch": "@@ -1 +1 @@\n-a\n+b"},
    {"filename": "src/main.py", "patch": "@@ -1 +1 @@\n-x\n+y"},  # non-target
    {"filename": "package.json", "patch": "@@ -1 +1 @@\n-p\n+q"},  # dep + target
    {"filename": "requirements.txt", "patch": "@@ -1 +1 @@\n-r\n+s"},  # changed dep
]
# Repo-root listing at the PR head ref.  Note it intentionally differs from the
# changed files: it has pnpm-lock.yaml (NOT changed by the PR) and lacks
# requirements.txt (which the PR changed).  dependency_files must reflect THIS
# (the project's dependency context), not the changed manifests.
_ROOT_LISTING = [
    {"type": "file", "name": "package.json", "path": "package.json"},
    {"type": "file", "name": "pnpm-lock.yaml", "path": "pnpm-lock.yaml"},
    {"type": "file", "name": "README.md", "path": "README.md"},
    {"type": "dir", "name": "src", "path": "src"},
]
_README_BODY = "MyLib is a small utility library for widgets."


def _tool_result(payload_text: str, *, is_error: bool = False) -> dict:
    return {"isError": is_error, "content": [{"text": payload_text}]}


def _make_mcp(
    pr_get: dict | None = None,
    pr_files: list[dict] | None = None,
    readme_blocks: list[str] | None = None,
    readme_error: bool = False,
    root_listing: list[dict] | None = None,
    root_error: bool = False,
) -> MagicMock:
    """Build a mock MCP client whose call_tool_sync dispatches by arguments."""
    pr_get = _PR_GET if pr_get is None else pr_get
    pr_files = _PR_FILES if pr_files is None else pr_files
    root_listing = _ROOT_LISTING if root_listing is None else root_listing
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
            # Root directory listing (dependency files) vs README file body.
            if arguments.get("path") == "/":
                if root_error:
                    return _tool_result("error", is_error=True)
                return _tool_result(json.dumps(root_listing))
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
        assert collector._mcp_startup_retry_attempts == 3
        assert collector._mcp_startup_retry_backoff_seconds == 1.0

    def test_custom_values(self):
        collector = PRInfoCollector(
            github_token="tok",
            model_id="gpt-4o-mini",
            mcp_url="https://custom.example.com/mcp",
            mcp_startup_retry_attempts=5,
            mcp_startup_retry_backoff_seconds=2.5,
        )
        assert collector._model_id == "gpt-4o-mini"
        assert collector._mcp_url == "https://custom.example.com/mcp"
        assert collector._mcp_startup_retry_attempts == 5
        assert collector._mcp_startup_retry_backoff_seconds == 2.5


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
        # Patch is included when within context limits (default 30,000 chars / 30 files).
        assert result.pr_info.file_changes[0].patch == "@@ -1 +1 @@\n-a\n+b"
        assert result.pr_info.file_changes[1].patch == "@@ -1 +1 @@\n-p\n+q"

    def test_dependency_files_from_repo_root_not_changed_files(self):
        """dependency_files reflect the repo's manifests at the PR head ref,
        not only the manifests the PR changed."""
        result = self._run(_make_mcp())
        # Root listing has package.json + pnpm-lock.yaml; the PR changed
        # requirements.txt (not at root) -- it must NOT appear, and the
        # unchanged pnpm-lock.yaml MUST appear.
        assert result.dependency_files == ["package.json", "pnpm-lock.yaml"]

    def test_dependency_files_listed_at_pr_head_ref(self):
        """The root listing is pinned to the PR head SHA."""
        mcp = _make_mcp()
        self._run(mcp)
        root_calls = [
            c
            for c in mcp.call_tool_sync.call_args_list
            if c.args[1] == "get_file_contents" and c.args[2].get("path") == "/"
        ]
        assert len(root_calls) == 1
        assert root_calls[0].args[2]["ref"] == "headsha123"

    def test_dependency_files_are_sorted(self):
        """Output is sorted regardless of server-side listing order."""
        unsorted_root = [
            {"type": "file", "name": "pyproject.toml", "path": "pyproject.toml"},
            {"type": "file", "name": "package.json", "path": "package.json"},
            {"type": "file", "name": "Pipfile", "path": "Pipfile"},
        ]
        result = self._run(_make_mcp(root_listing=unsorted_root))
        assert result.dependency_files == ["Pipfile", "package.json", "pyproject.toml"]

    def test_readme_fetched_at_pr_head_ref(self):
        """README is read at the PR head ref for reproducible summaries."""
        mcp = _make_mcp()
        self._run(mcp)
        readme_calls = [
            c
            for c in mcp.call_tool_sync.call_args_list
            if c.args[1] == "get_file_contents" and c.args[2].get("path") == "README.md"
        ]
        assert len(readme_calls) == 1
        assert readme_calls[0].args[2]["ref"] == "headsha123"

    def test_dependency_files_empty_when_root_listing_unavailable(self):
        result = self._run(_make_mcp(root_error=True))
        assert result.dependency_files == []

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

    def test_summary_failure_does_not_discard_facts(self):
        """If the summary LLM raises, facts are kept and summary is empty."""
        collector = PRInfoCollector(github_token="tok")
        failing_agent = MagicMock(side_effect=RuntimeError("model load failed"))
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=failing_agent),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            result = collector.collect("mui", "material-ui", 48591)
        assert result.project_summary == ""
        # Deterministic facts are still present.
        assert result.pr_info.title == "[progress] Show runtime errors only once"
        assert result.dependency_files == ["package.json", "pnpm-lock.yaml"]

    def test_infra_exception_during_readme_summary_propagates(self):
        """An infra exception from the summary LLM must not be swallowed into
        an empty summary -- unlike a business/model-quality failure, it means
        the shared model connection is down and downstream reviewers relying
        on the same connection would fail too, so the caller should learn
        about it immediately rather than get a deceptively "complete" result.
        """
        collector = PRInfoCollector(github_token="tok")
        failing_agent = MagicMock(
            side_effect=EventLoopException(ConnectError("model connection lost"))
        )
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=failing_agent),
            patch(f"{_MOD}.OpenAIModel"),
            pytest.raises(EventLoopException),
        ):
            collector.collect("mui", "material-ui", 48591)

    def test_infra_exception_during_dependency_listing_propagates(self):
        def dispatch(tool_use_id, name, arguments):
            if name == "pull_request_read" and arguments["method"] == "get":
                return _tool_result(json.dumps(_PR_GET))
            if name == "pull_request_read" and arguments["method"] == "get_files":
                batch = _PR_FILES if arguments.get("page", 1) == 1 else []
                return _tool_result(json.dumps(batch))
            if name == "get_file_contents" and arguments.get("path") == "/":
                raise ConnectError("mcp connection lost")
            if name == "get_file_contents":
                return {"isError": False, "content": [{"text": _README_BODY}]}
            raise AssertionError(f"unexpected tool call: {name} {arguments}")

        mcp = MagicMock()
        mcp.call_tool_sync.side_effect = dispatch
        collector = PRInfoCollector(github_token="tok")
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=MagicMock(return_value="s")),
            patch(f"{_MOD}.OpenAIModel"),
            pytest.raises(ConnectError),
        ):
            collector.collect("mui", "material-ui", 48591)

    def test_infra_exception_during_readme_fetch_propagates(self):
        def dispatch(tool_use_id, name, arguments):
            if name == "pull_request_read" and arguments["method"] == "get":
                return _tool_result(json.dumps(_PR_GET))
            if name == "pull_request_read" and arguments["method"] == "get_files":
                batch = _PR_FILES if arguments.get("page", 1) == 1 else []
                return _tool_result(json.dumps(batch))
            if name == "get_file_contents" and arguments.get("path") == "README.md":
                raise ConnectError("mcp connection lost")
            if name == "get_file_contents":
                return _tool_result(json.dumps(_ROOT_LISTING))
            raise AssertionError(f"unexpected tool call: {name} {arguments}")

        mcp = MagicMock()
        mcp.call_tool_sync.side_effect = dispatch
        collector = PRInfoCollector(github_token="tok")
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=MagicMock(return_value="s")),
            patch(f"{_MOD}.OpenAIModel"),
            pytest.raises(ConnectError),
        ):
            collector.collect("mui", "material-ui", 48591)

    def test_starts_and_stops_mcp_client(self):
        mcp = _make_mcp()
        self._run(mcp)
        mcp.start.assert_called_once()
        mcp.stop.assert_called_once_with(None, None, None)

    def test_stops_mcp_client_even_when_start_raises(self):
        """If start() fails, stop() must still run (start() is inside try)."""
        mcp = _make_mcp()
        mcp.start.side_effect = RuntimeError("startup failed")
        collector = PRInfoCollector(github_token="tok")
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=MagicMock()),
            patch(f"{_MOD}.OpenAIModel"),
            pytest.raises(RuntimeError, match="startup failed"),
        ):
            collector.collect("mui", "material-ui", 48591)
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
            github_token="mytoken",
            mcp_url="https://custom.example.com/mcp",
            mcp_startup_retry_attempts=5,
            mcp_startup_retry_backoff_seconds=2.5,
        )
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp) as factory,
            patch(f"{_MOD}.Agent", return_value=MagicMock(return_value="s")),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            collector.collect("mui", "material-ui", 48591)
        factory.assert_called_once_with(
            "mytoken",
            "https://custom.example.com/mcp",
            retry_attempts=5,
            retry_backoff_seconds=2.5,
        )

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
            model_id="gpt-4o",
            client_args={"base_url": "http://localhost:11434/v1"},
            params={"temperature": 0.3},
        )

    def test_logs_response_size(self, caplog):
        """collect() logs response size in bytes and file_changes count."""
        with caplog.at_level(
            logging.INFO, logger="code_review_agent.agents.pr_info_collector"
        ):
            self._run(_make_mcp())
        assert any(
            "bytes" in r.message and "file_changes" in r.message for r in caplog.records
        )

    def test_writes_response_to_file_when_env_set(self, tmp_path):
        """When PR_INFO_COLLECTOR_RESPONSE_FILE is set, writes JSON to that path."""
        out_file = tmp_path / "response.json"
        try:
            with patch.dict(
                os.environ, {"PR_INFO_COLLECTOR_RESPONSE_FILE": str(out_file)}
            ):
                result = self._run(_make_mcp())
            written = json.loads(out_file.read_text())
            assert written["pr_info"]["title"] == result.pr_info.title
        finally:
            out_file.unlink(missing_ok=True)

    def test_writes_response_to_filename_only_uses_cwd(self, tmp_path, monkeypatch):
        """When only a filename is given (no directory), the file is written to cwd."""
        out_file = tmp_path / "response.json"
        monkeypatch.chdir(tmp_path)
        try:
            with patch.dict(
                os.environ, {"PR_INFO_COLLECTOR_RESPONSE_FILE": "response.json"}
            ):
                result = self._run(_make_mcp())
            written = json.loads(out_file.read_text())
            assert written["pr_info"]["title"] == result.pr_info.title
        finally:
            out_file.unlink(missing_ok=True)

    def test_logs_absolute_path_after_write(self, tmp_path, caplog):
        """Absolute output path is logged at INFO level after a successful write."""
        out_file = tmp_path / "response.json"
        try:
            with (
                caplog.at_level(
                    logging.INFO, logger="code_review_agent.agents.pr_info_collector"
                ),
                patch.dict(
                    os.environ, {"PR_INFO_COLLECTOR_RESPONSE_FILE": str(out_file)}
                ),
            ):
                self._run(_make_mcp())
            assert any(str(out_file) in r.message for r in caplog.records)
        finally:
            out_file.unlink(missing_ok=True)

    def test_writes_response_to_nested_dir_when_env_set(self, tmp_path):
        """Parent directories are created automatically when they do not exist."""
        out_file = tmp_path / "new_subdir" / "response.json"
        try:
            with patch.dict(
                os.environ, {"PR_INFO_COLLECTOR_RESPONSE_FILE": str(out_file)}
            ):
                result = self._run(_make_mcp())
            written = json.loads(out_file.read_text())
            assert written["pr_info"]["title"] == result.pr_info.title
        finally:
            out_file.unlink(missing_ok=True)

    def test_no_file_written_when_env_not_set(self, tmp_path):
        """When PR_INFO_COLLECTOR_RESPONSE_FILE is absent, no file is written."""
        env = {
            k: v
            for k, v in os.environ.items()
            if k != "PR_INFO_COLLECTOR_RESPONSE_FILE"
        }
        with patch.dict(os.environ, env, clear=True):
            self._run(_make_mcp())
        assert list(tmp_path.iterdir()) == []

    def test_file_write_error_does_not_fail_collect(self, tmp_path):
        """Write errors are logged as warnings and do not raise."""
        # Place a regular file where makedirs would need to create a directory,
        # causing NotADirectoryError (a subclass of OSError).
        blocker = tmp_path / "not_a_dir"
        blocker.write_text("I am a file, not a directory")
        bad_path = str(blocker / "response.json")
        with patch.dict(os.environ, {"PR_INFO_COLLECTOR_RESPONSE_FILE": bad_path}):
            result = self._run(_make_mcp())
        assert isinstance(result, PRInfoResult)

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

    def test_summary_agent_called_with_default_limits(self):
        """_summarize_readme passes limits={"turns": 30} by default."""
        collector = PRInfoCollector(github_token="tok")
        mock_agent = MagicMock(return_value="summary text.")
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            collector.collect("mui", "material-ui", 48591)

        _, kwargs = mock_agent.call_args
        assert kwargs.get("limits") == {"turns": 30}

    def test_summary_agent_called_with_custom_max_agent_turns(self):
        """Custom max_agent_turns is forwarded to summary agent limits."""
        collector = PRInfoCollector(github_token="tok", max_agent_turns=5)
        mock_agent = MagicMock(return_value="summary text.")
        mcp = _make_mcp()
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            collector.collect("mui", "material-ui", 48591)

        _, kwargs = mock_agent.call_args
        assert kwargs.get("limits") == {"turns": 5}

    def test_patches_included_within_limit(self):
        """Patches are included in FileChange when total size is within limits."""
        result = self._run(_make_mcp())
        for fc in result.pr_info.file_changes:
            assert fc.patch is not None

    def test_patches_fallback_when_total_chars_exceed_limit(self, caplog):
        """patch=None for all files when total patch chars exceed the limit."""
        # Build files where combined patch exceeds a tiny limit.
        big_files = [
            {"filename": "src/a.ts", "patch": "x" * 50},
            {"filename": "src/b.ts", "patch": "y" * 50},
        ]
        collector = PRInfoCollector(
            github_token="tok",
            patch_total_char_limit=99,  # less than 100 chars total
            patch_max_files=30,
        )
        mock_agent = MagicMock(return_value="summary")
        mcp = _make_mcp(pr_files=big_files)
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel"),
            caplog.at_level(
                logging.WARNING, logger="code_review_agent.agents.pr_info_collector"
            ),
        ):
            result = collector.collect("mui", "material-ui", 48591)
        for fc in result.pr_info.file_changes:
            assert fc.patch is None
        assert any("falling back to patch=None" in r.message for r in caplog.records)

    def test_patches_fallback_when_file_count_exceeds_limit(self, caplog):
        """patch=None for all files when target-file count exceeds the limit."""
        many_files = [{"filename": f"src/f{i}.ts", "patch": "p"} for i in range(5)]
        collector = PRInfoCollector(
            github_token="tok",
            patch_total_char_limit=30_000,
            patch_max_files=4,  # 5 files > limit of 4
        )
        mock_agent = MagicMock(return_value="summary")
        mcp = _make_mcp(pr_files=many_files)
        with (
            patch(f"{_MOD}.create_github_mcp_client", return_value=mcp),
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel"),
            caplog.at_level(
                logging.WARNING, logger="code_review_agent.agents.pr_info_collector"
            ),
        ):
            result = collector.collect("mui", "material-ui", 48591)
        for fc in result.pr_info.file_changes:
            assert fc.patch is None
        assert any("falling back to patch=None" in r.message for r in caplog.records)
