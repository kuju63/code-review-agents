"""PR Info Collector agent.

Collects pull request information from GitHub and returns structured data
for use by downstream review agents.

Design note (2026-06-13): the factual fields (title, body, labels, file
changes) are retrieved **deterministically** from the GitHub MCP server via
``MCPClient.call_tool_sync`` -- no LLM tool loop and no ``structured_output``.
An LLM had previously been asked to structure these facts, but a small model
fabricated file paths and paraphrased the title/labels even when the correct
data was already in context (see
``docs/pr-info-collector-tooluse-fix-spec.md`` §2.5).  Deterministic mapping
makes file-path hallucination impossible and removes the runaway tool loop.
The only LLM call left is summarising the README into ``project_summary``.
"""

import json
import os
from typing import Any

from strands import Agent
from strands.models.openai import OpenAIModel

from ..models.pr_info import FileChange, PRInfo, PRInfoResult, RepositoryInfo
from ..tools.github_mcp import GITHUB_MCP_URL, create_github_mcp_client

SUMMARY_SYSTEM_PROMPT = """\
You are given the README of a software project. Summarise what the project is \
and what it does in 2-4 concise sentences of plain prose. Base the summary only \
on the provided README text; do not invent facts. Output the summary text only, \
with no preamble, headings, or markdown.
"""

_TARGET_EXTENSIONS = frozenset([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html"])
_TARGET_FILENAMES = frozenset(["package.json"])
_DEPENDENCY_FILENAMES = frozenset(
    [
        "package.json",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "pyproject.toml",
        "requirements.txt",
        "poetry.lock",
        "Pipfile",
        "Pipfile.lock",
    ]
)

# README is truncated before summarisation to keep the single LLM call cheap
# and within context limits for small local models.
_README_MAX_CHARS = 6000
# GitHub MCP ``get_files`` is paginated; request large pages and loop until a
# short page signals the end so large PRs are covered comprehensively.
_FILES_PER_PAGE = 100


def is_target_file(file_path: str) -> bool:
    """Return True if the file should be included in the review.

    Includes TypeScript/JavaScript, CSS/SCSS, HTML, and package.json files.

    Args:
        file_path: Relative path to the file within the repository.

    Returns:
        True when the file matches a target extension or filename.
    """
    _, ext = os.path.splitext(file_path)
    filename = os.path.basename(file_path)
    return ext.lower() in _TARGET_EXTENSIONS or filename in _TARGET_FILENAMES


def is_dependency_file(file_path: str) -> bool:
    """Return True if the file is a dependency manifest or lock file.

    Args:
        file_path: Relative path to the file within the repository.

    Returns:
        True when the basename matches a known dependency manifest filename.
    """
    return os.path.basename(file_path) in _DEPENDENCY_FILENAMES


def _extract_label_names(labels: Any) -> list[str]:
    """Normalise a PR ``labels`` field into a list of label name strings.

    The GitHub MCP ``pull_request_read`` ``get`` method returns labels as plain
    strings (``["scope: progress"]``), whereas the REST API shape is a list of
    objects (``[{"name": ...}]``).  Both are accepted so the mapping does not
    depend on which shape the endpoint happens to return.

    Args:
        labels: The raw ``labels`` value from the PR payload.

    Returns:
        The label names as a list of strings.
    """
    names: list[str] = []
    for label in labels or []:
        if isinstance(label, str):
            names.append(label)
        elif isinstance(label, dict) and label.get("name"):
            names.append(label["name"])
    return names


def _tool_text_blocks(result: dict[str, Any]) -> list[str]:
    """Extract the text payloads from an MCP tool result.

    Args:
        result: The dict returned by ``MCPClient.call_tool_sync``.

    Returns:
        The non-empty ``text`` fields of the result content blocks.

    Raises:
        RuntimeError: If the tool reported an error.
    """
    if result.get("isError"):
        texts = [b.get("text", "") for b in result.get("content", []) if b.get("text")]
        raise RuntimeError(f"GitHub MCP tool error: {' '.join(texts) or 'unknown'}")
    return [b["text"] for b in result.get("content", []) if b.get("text")]


class PRInfoCollector:
    """Collects PR information from GitHub deterministically.

    Retrieves PR details and the changed-file list directly from the GitHub
    MCP server (no LLM tool loop), maps them onto :class:`PRInfoResult`, and
    uses a single tool-free LLM call only to summarise the project README.

    Args:
        github_token: GitHub personal access token or Copilot token.
        model_id: OpenAI-compatible model ID used for the README summary.
        mcp_url: URL of the GitHub MCP endpoint.
        llm_base_url: Optional OpenAI-compatible base URL (e.g. LM Studio).
    """

    def __init__(
        self,
        github_token: str,
        model_id: str = "gpt-4o",
        mcp_url: str = GITHUB_MCP_URL,
        llm_base_url: str | None = None,
    ) -> None:
        self._github_token = github_token
        self._model_id = model_id
        self._mcp_url = mcp_url
        self._llm_base_url = llm_base_url

    def collect(self, owner: str, repo: str, pr_number: int) -> PRInfoResult:
        """Collect PR information from GitHub and return structured data.

        Connects to the GitHub MCP endpoint, retrieves the PR details, the
        full changed-file list, and the README deterministically, then maps
        them onto a validated :class:`PRInfoResult`.  File changes are filtered
        so only review-relevant files (see :func:`is_target_file`) are kept.
        The README is summarised with a single tool-free LLM call.

        Args:
            owner: Repository owner (user or organization name).
            repo: Repository name.
            pr_number: Pull request number.

        Returns:
            Structured PR information ready for downstream review agents.
        """
        mcp_client = create_github_mcp_client(self._github_token, self._mcp_url)
        # Used standalone (not via Agent), we own the client's lifecycle.  Start
        # inside the ``try`` so that a failing ``start()`` (e.g. connection or
        # auth error) still reaches ``finally`` and is cleaned up; ``stop()`` is
        # safe to call even when ``start()`` did not complete.
        try:
            mcp_client.start()
            pr_details = self._read_pr_details(mcp_client, owner, repo, pr_number)
            changed_files = self._read_changed_files(mcp_client, owner, repo, pr_number)
            readme_text = self._read_readme(mcp_client, owner, repo)
        finally:
            mcp_client.stop(None, None, None)

        project_summary = self._summarize_readme(readme_text) if readme_text else ""

        file_changes = [
            FileChange(filePath=f["filename"], patch=f.get("patch"))
            for f in changed_files
            if is_target_file(f.get("filename", ""))
        ]
        dependency_files = [
            f["filename"]
            for f in changed_files
            if is_dependency_file(f.get("filename", ""))
        ]

        return PRInfoResult(
            repository_info=RepositoryInfo(owner=owner, repository=repo),
            project_summary=project_summary,
            pr_info=PRInfo(
                title=pr_details.get("title", ""),
                pr_number=pr_details.get("number", pr_number),
                body=pr_details.get("body"),
                labels=_extract_label_names(pr_details.get("labels", [])),
                file_changes=file_changes,
            ),
            dependency_files=dependency_files,
        )

    def _read_pr_details(
        self, mcp_client: Any, owner: str, repo: str, pr_number: int
    ) -> dict[str, Any]:
        """Fetch PR metadata (title, body, labels, number) deterministically."""
        result = mcp_client.call_tool_sync(
            "pr-get",
            "pull_request_read",
            {
                "method": "get",
                "owner": owner,
                "repo": repo,
                "pullNumber": pr_number,
            },
        )
        texts = _tool_text_blocks(result)
        return json.loads(texts[0]) if texts else {}

    def _read_changed_files(
        self, mcp_client: Any, owner: str, repo: str, pr_number: int
    ) -> list[dict[str, Any]]:
        """Fetch the full changed-file list, paging until exhausted."""
        files: list[dict[str, Any]] = []
        page = 1
        while True:
            result = mcp_client.call_tool_sync(
                f"pr-files-{page}",
                "pull_request_read",
                {
                    "method": "get_files",
                    "owner": owner,
                    "repo": repo,
                    "pullNumber": pr_number,
                    "page": page,
                    "perPage": _FILES_PER_PAGE,
                },
            )
            texts = _tool_text_blocks(result)
            batch = json.loads(texts[0]) if texts else []
            if not batch:
                break
            files.extend(batch)
            if len(batch) < _FILES_PER_PAGE:
                break
            page += 1
        return files

    def _read_readme(self, mcp_client: Any, owner: str, repo: str) -> str | None:
        """Fetch the repository README text, or None if unavailable."""
        try:
            result = mcp_client.call_tool_sync(
                "readme",
                "get_file_contents",
                {"owner": owner, "repo": repo, "path": "README.md"},
            )
            texts = _tool_text_blocks(result)
        except Exception:
            return None
        # ``get_file_contents`` returns a status block followed by the file
        # body; the last text block holds the README content.
        return texts[-1] if texts else None

    def _build_model(self) -> OpenAIModel:
        """Build the OpenAI-compatible model for README summarisation."""
        if self._llm_base_url:
            return OpenAIModel(
                model_id=self._model_id,
                client_args={"base_url": self._llm_base_url},
            )
        return OpenAIModel(model_id=self._model_id)

    def _summarize_readme(self, readme_text: str) -> str:
        """Summarise the README with a single tool-free LLM call."""
        agent = Agent(model=self._build_model(), system_prompt=SUMMARY_SYSTEM_PROMPT)
        result = agent(readme_text[:_README_MAX_CHARS])
        return str(result).strip()
