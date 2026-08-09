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
import logging
import os
from typing import Any

from strands import Agent
from strands.models import Model

from ..models.pr_info import FileChange, PRInfo, PRInfoResult, RepositoryInfo
from ..tools.github_mcp import GITHUB_MCP_URL, create_github_mcp_client
from .exceptions import INFRA_EXCEPTIONS
from .model_provider_factory import ProviderType, create_model_provider

logger = logging.getLogger(__name__)

SUMMARY_SYSTEM_PROMPT = """\
You are given the README of a software project. Summarise what the project is \
and what it does in 2-4 concise sentences of plain prose. Base the summary only \
on the provided README text; do not invent facts. Output the summary text only, \
with no preamble, headings, or markdown.
"""

_TARGET_EXTENSIONS = frozenset(
    [".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html", ".svelte", ".vue"]
)
_TARGET_FILENAMES = frozenset(
    [
        "package.json",
        "angular.json",
        "svelte.config.js",
        "svelte.config.ts",
        "vue.config.js",
        "vue.config.ts",
    ]
)
_DEPENDENCY_FILENAMES = frozenset(
    [
        "package.json",
        "angular.json",
        "svelte.config.js",
        "svelte.config.ts",
        "vue.config.js",
        "vue.config.ts",
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

# Manifest content fetched for stack detection (Issue #230). yarn.lock is
# deliberately excluded: its v1 format mixes direct and transitive
# dependencies with no way to tell them apart from the file alone.
_ROOT_PACKAGE_JSON = "package.json"
_LOCKFILE_CONTENT_NAMES = ("package-lock.json", "pnpm-lock.yaml")
# Bounds on workspace resolution to cap GitHub MCP calls against a
# `workspaces` declaration with many glob patterns or matched packages.
_MAX_WORKSPACE_GLOBS = 10
_MAX_WORKSPACE_PACKAGES = 20

# README is truncated before summarisation to keep the single LLM call cheap
# and within context limits for small local models.
_README_MAX_CHARS = 6000
# GitHub MCP ``get_files`` is paginated; request large pages and loop until a
# short page signals the end so large PRs are covered comprehensively.
_FILES_PER_PAGE = 100


def is_target_file(file_path: str) -> bool:
    """Return True if the file should be included in the review.

    Includes TypeScript/JavaScript, CSS/SCSS, HTML, Svelte, Vue, and
    package.json files.

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


def _extract_head_ref(pr_details: dict[str, Any]) -> str | None:
    """Return the PR head commit SHA (or ref) to pin "point in time" reads.

    Args:
        pr_details: The parsed ``pull_request_read`` ``get`` payload.

    Returns:
        The head commit SHA if available, else the head ref name, else None
        (in which case callers fall back to the repository default branch).
    """
    head = pr_details.get("head") or {}
    if isinstance(head, dict):
        return head.get("sha") or head.get("ref")
    return None


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
        mcp_startup_retry_attempts: Maximum GitHub MCP startup attempts
            (including the first), forwarded to
            :func:`~code_review_agent.tools.github_mcp.create_github_mcp_client`.
        mcp_startup_retry_backoff_seconds: Base wait time in seconds for the
            startup retry's exponential backoff+jitter, forwarded to
            :func:`~code_review_agent.tools.github_mcp.create_github_mcp_client`.
    """

    def __init__(
        self,
        github_token: str,
        model_id: str = "gpt-4o",
        mcp_url: str = GITHUB_MCP_URL,
        llm_base_url: str | None = None,
        provider_type: ProviderType = ProviderType.OPENAI,
        max_agent_turns: int = 30,
        patch_total_char_limit: int = 30_000,
        patch_max_files: int = 30,
        mcp_startup_retry_attempts: int = 3,
        mcp_startup_retry_backoff_seconds: float = 1.0,
    ) -> None:
        """Store the GitHub/LLM connection settings used by :meth:`collect`.

        Args:
            github_token: GitHub personal access token or Copilot token.
            model_id: OpenAI-compatible model ID used for the README summary.
            mcp_url: URL of the GitHub MCP endpoint.
            llm_base_url: Optional OpenAI-compatible base URL (e.g. LM Studio).
            provider_type: Which backend :func:`create_model_provider` builds
                the README-summary model against.
            max_agent_turns: Maximum agent loop iterations for the README
                summary call.
            patch_total_char_limit: Maximum combined patch size (characters)
                across target files before patches are omitted in favor of
                ``patch=None``.
            patch_max_files: Maximum number of target files before patches are
                omitted in favor of ``patch=None``.
            mcp_startup_retry_attempts: Maximum GitHub MCP startup attempts
                (including the first), forwarded to
                :func:`~code_review_agent.tools.github_mcp.create_github_mcp_client`.
            mcp_startup_retry_backoff_seconds: Base wait time in seconds for
                the startup retry's exponential backoff+jitter, forwarded to
                :func:`~code_review_agent.tools.github_mcp.create_github_mcp_client`.
        """
        self._github_token = github_token
        self._model_id = model_id
        self._mcp_url = mcp_url
        self._llm_base_url = llm_base_url
        self._provider_type = provider_type
        self._max_agent_turns = max_agent_turns
        self._patch_total_char_limit = patch_total_char_limit
        self._patch_max_files = patch_max_files
        self._mcp_startup_retry_attempts = mcp_startup_retry_attempts
        self._mcp_startup_retry_backoff_seconds = mcp_startup_retry_backoff_seconds

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

        Raises:
            INFRA_EXCEPTIONS: An infrastructure-level error (model connection
                lost, GitHub MCP client init failure, transport-level
                timeout) occurred while starting or using the GitHub MCP
                client, or during the README summary's model call, rather
                than a business-level failure. Collection is not guaranteed
                to have completed when this is raised.
        """
        mcp_client = create_github_mcp_client(
            self._github_token,
            self._mcp_url,
            retry_attempts=self._mcp_startup_retry_attempts,
            retry_backoff_seconds=self._mcp_startup_retry_backoff_seconds,
        )
        # Used standalone (not via Agent), we own the client's lifecycle.  Start
        # inside the ``try`` so that a failing ``start()`` (e.g. connection or
        # auth error) still reaches ``finally`` and is cleaned up; ``stop()`` is
        # safe to call even when ``start()`` did not complete.
        try:
            mcp_client.start()
            pr_details = self._read_pr_details(mcp_client, owner, repo, pr_number)
            # Pin all repo-content reads to the PR head commit so the result is
            # reproducible and reflects this PR's point in time (rather than the
            # moving default branch).
            head_ref = _extract_head_ref(pr_details)
            changed_files = self._read_changed_files(mcp_client, owner, repo, pr_number)
            readme_text = self._read_readme(mcp_client, owner, repo, head_ref)
            # ``dependency_files`` describes the packages the project depends on
            # so downstream reviewers know the dependency context.  It is the set
            # of manifest files present in the repo at this PR's point in time --
            # NOT only the manifests changed by the PR -- so we list the repo
            # root at the PR head ref rather than deriving from changed files.
            dependency_files = self._read_dependency_files(
                mcp_client, owner, repo, head_ref
            )
            # Content-based stack detection (Issue #230) needs the actual
            # text of package.json/lock files, not just their paths.
            manifest_contents = self._read_manifest_contents(
                mcp_client, owner, repo, head_ref, dependency_files
            )
        finally:
            mcp_client.stop(None, None, None)

        # The README summary is the only non-deterministic step.  It must never
        # discard the deterministically-fetched facts: if the summary itself is
        # rejected or malformed, fall back to an empty summary rather than
        # failing the whole collect(). Infra failures (model connection lost,
        # etc.) are re-raised instead -- they signal the shared model
        # connection is down, which the downstream review stage relying on the
        # same connection needs to know about rather than silently proceed.
        project_summary = ""
        if readme_text:
            try:
                project_summary = self._summarize_readme(readme_text)
            except INFRA_EXCEPTIONS:
                raise
            except Exception:
                project_summary = ""

        # Include patch in FileChange when the total diff size is within limits.
        # Providing patches upfront lets reviewers skip GitHub MCP fetches, which
        # avoids the context-accumulation overflow seen with patch=None (#48325 fix
        # introduced the omission; this reinstates patches for normal-sized PRs).
        # When total diff exceeds limits, fall back to patch=None so reviewers can
        # still fetch diffs via MCP (context overflow risk remains for large PRs).
        target_files = [
            f for f in changed_files if is_target_file(f.get("filename", ""))
        ]
        total_patch_chars = sum(len(f.get("patch") or "") for f in target_files)
        include_patches = (
            len(target_files) <= self._patch_max_files
            and total_patch_chars <= self._patch_total_char_limit
        )
        if not include_patches:
            logger.warning(
                "PR diff exceeds context limit (%d chars across %d files): "
                "falling back to patch=None. Reviewers will fetch diffs via GitHub MCP.",
                total_patch_chars,
                len(target_files),
            )
        file_changes = [
            FileChange(
                filePath=f.get("filename", ""),
                patch=f.get("patch") if include_patches else None,
            )
            for f in target_files
        ]

        result = PRInfoResult(
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
            manifest_contents=manifest_contents,
        )

        result_json = result.model_dump_json()
        logger.info(
            "PRInfoCollector response: %d bytes, %d file_changes",
            len(result_json.encode()),
            len(result.pr_info.file_changes),
        )

        output_path = os.environ.get("PR_INFO_COLLECTOR_RESPONSE_FILE")
        if output_path:
            try:
                parent = os.path.dirname(output_path)
                if parent:
                    os.makedirs(parent, exist_ok=True)
                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(result_json)
                logger.info(
                    "PR collector response written to %s",
                    os.path.abspath(output_path),
                )
            except OSError as exc:
                logger.warning(
                    "Failed to write PR collector response to %s: %s", output_path, exc
                )

        return result

    def _read_pr_details(
        self, mcp_client: Any, owner: str, repo: str, pr_number: int
    ) -> dict[str, Any]:
        """Fetch PR metadata (title, body, labels, number) deterministically.

        Returns:
            The parsed ``pull_request_read`` ``get`` payload, or an empty dict
            if the tool returned no text content.
        """
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
        """Fetch the full changed-file list, paging until exhausted.

        Returns:
            The raw changed-file entries (as returned by ``get_files``) across
            all pages, in page order.
        """
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

    def _list_directory_entries(
        self, mcp_client: Any, owner: str, repo: str, ref: str | None, path: str
    ) -> list[dict[str, Any]]:
        """List the raw ``get_file_contents`` directory entries at ``path``.

        Shared by :meth:`_read_dependency_files` (repo root, filtered to
        manifest files) and workspace resolution (a workspace glob's parent
        directory, filtered to subdirectories). Infra failures (MCP
        connection lost, etc.) are re-raised rather than degraded to an
        empty list -- see :data:`INFRA_EXCEPTIONS`.

        Returns:
            The raw entry dicts as returned by the GitHub MCP server, or an
            empty list if the listing is unavailable or unparseable.

        Raises:
            INFRA_EXCEPTIONS: The listing call failed due to an
                infrastructure-level error (model connection lost, GitHub MCP
                client init failure, transport-level timeout) rather than a
                business-level failure.
        """
        args: dict[str, Any] = {"owner": owner, "repo": repo, "path": path}
        if ref:
            args["ref"] = ref
        try:
            result = mcp_client.call_tool_sync(
                f"dir-listing-{path}", "get_file_contents", args
            )
            texts = _tool_text_blocks(result)
        except INFRA_EXCEPTIONS:
            raise
        except Exception:
            return []
        if not texts:
            return []
        try:
            entries = json.loads(texts[-1])
        except (ValueError, TypeError):
            return []
        return entries if isinstance(entries, list) else []

    def _read_dependency_files(
        self, mcp_client: Any, owner: str, repo: str, ref: str | None
    ) -> list[str]:
        """List dependency manifest files at the repo root for the given ref.

        Returns the paths of dependency manifests (see
        :func:`is_dependency_file`) present at the repository root at ``ref``,
        describing the project's dependency context regardless of whether the
        PR changed them.  Returns an empty list if the listing is unavailable.

        Returns:
            Sorted paths of dependency manifest files at the repo root, or an
            empty list if the listing is unavailable or unparseable.
        """
        entries = self._list_directory_entries(mcp_client, owner, repo, ref, "/")
        # Sort for deterministic output regardless of server-side listing order.
        return sorted(
            entry["path"]
            for entry in entries
            if isinstance(entry, dict)
            and entry.get("type") == "file"
            and is_dependency_file(entry.get("path", ""))
        )

    def _read_file_text(
        self, mcp_client: Any, owner: str, repo: str, ref: str | None, path: str
    ) -> str | None:
        """Fetch a repository file's text content at ``ref``, or None.

        Shared by README, ``package.json``, and lock-file/workspace-manifest
        fetches -- they all call the same ``get_file_contents`` tool and
        return its last text block. Infra failures (MCP connection lost,
        etc.) are re-raised rather than degraded to ``None`` -- see
        :data:`INFRA_EXCEPTIONS`.

        Returns:
            The file's text content at ``ref``, or ``None`` if unavailable.

        Raises:
            INFRA_EXCEPTIONS: The file-contents call failed due to an
                infrastructure-level error (model connection lost, GitHub MCP
                client init failure, transport-level timeout) rather than a
                business-level failure.
        """
        args: dict[str, Any] = {"owner": owner, "repo": repo, "path": path}
        if ref:
            args["ref"] = ref
        try:
            result = mcp_client.call_tool_sync(
                f"file-{path}", "get_file_contents", args
            )
            texts = _tool_text_blocks(result)
        except INFRA_EXCEPTIONS:
            raise
        except Exception:
            return None
        return texts[-1] if texts else None

    def _resolve_workspace_package_json_paths(
        self,
        mcp_client: Any,
        owner: str,
        repo: str,
        ref: str | None,
        root_package_json_text: str,
    ) -> list[str]:
        """Resolve a root ``package.json``'s ``workspaces`` field to paths.

        Supports the common workspace declaration shapes -- a plain glob
        array (npm/pnpm) and yarn's ``{"packages": [...]}`` object form.
        Only exact paths and a single trailing ``/*`` wildcard are resolved;
        nested or multi-segment globs are skipped (documented limitation,
        see docs/review-agents-design.md). Resolution is bounded by
        :data:`_MAX_WORKSPACE_GLOBS` and :data:`_MAX_WORKSPACE_PACKAGES` to
        cap GitHub MCP calls against workspace declarations with many
        packages.

        Returns:
            Sorted, de-duplicated ``{workspace_dir}/package.json`` paths, or
            an empty list if ``workspaces`` is absent or unparseable.
        """
        try:
            data = json.loads(root_package_json_text)
        except (ValueError, TypeError):
            return []
        if not isinstance(data, dict):
            return []
        workspaces = data.get("workspaces")
        if isinstance(workspaces, dict):
            workspaces = workspaces.get("packages")
        if not isinstance(workspaces, list):
            return []
        patterns = [p for p in workspaces if isinstance(p, str)]

        resolved_dirs: set[str] = set()
        for pattern in patterns[:_MAX_WORKSPACE_GLOBS]:
            # Reject path-traversal-looking or absolute patterns outright,
            # rather than forwarding them as a GitHub MCP ``path`` argument.
            if ".." in pattern or pattern.startswith("/"):
                continue
            if pattern.endswith("/*"):
                prefix = pattern[: -len("/*")]
                entries = self._list_directory_entries(
                    mcp_client, owner, repo, ref, prefix
                )
                resolved_dirs.update(
                    entry["path"]
                    for entry in entries
                    if isinstance(entry, dict)
                    and entry.get("type") == "dir"
                    and entry.get("path")
                )
            elif "*" not in pattern:
                resolved_dirs.add(pattern)
            # Nested/multi-wildcard globs (e.g. "packages/**") are not
            # supported and are silently skipped.

        return [
            f"{workspace_dir}/package.json"
            for workspace_dir in sorted(resolved_dirs)[:_MAX_WORKSPACE_PACKAGES]
        ]

    def _read_manifest_contents(
        self,
        mcp_client: Any,
        owner: str,
        repo: str,
        ref: str | None,
        dependency_files: list[str],
    ) -> dict[str, str]:
        """Fetch the text content of manifests used for stack detection.

        Fetches ``package.json`` when GitHub reports it present at the repo
        root (``dependency_files``), plus each workspace package's
        ``package.json`` resolved from the root manifest's ``workspaces``
        field (see :meth:`_resolve_workspace_package_json_paths``). Lock
        files (``package-lock.json``, ``pnpm-lock.yaml``) are fetched only
        when the root ``package.json`` could not be read (absent from
        ``dependency_files``, or its fetch failed): once package.json content
        is available,
        :func:`~code_review_agent.agents.manifest_detection.collect_direct_package_names`
        never falls back to lock-file content, so fetching it too would be a
        wasted GitHub MCP call. ``yarn.lock`` is intentionally never fetched:
        its v1 format mixes direct and transitive dependencies with no way to
        tell them apart, so its content cannot safely drive detection.

        A manifest that fails to fetch (missing, transient error) is simply
        omitted rather than failing the whole collection -- content-based
        detection degrades gracefully to the coarser tiers when content is
        unavailable.

        Returns:
            Mapping of repository-relative manifest path to its raw text
            content, for every manifest that was fetched successfully.
        """
        contents: dict[str, str] = {}
        dependency_file_set = set(dependency_files)

        root_package_json_text: str | None = None
        if _ROOT_PACKAGE_JSON in dependency_file_set:
            root_package_json_text = self._read_file_text(
                mcp_client, owner, repo, ref, _ROOT_PACKAGE_JSON
            )
            if root_package_json_text is not None:
                contents[_ROOT_PACKAGE_JSON] = root_package_json_text

        if root_package_json_text is None:
            for lock_name in _LOCKFILE_CONTENT_NAMES:
                if lock_name in dependency_file_set:
                    text = self._read_file_text(mcp_client, owner, repo, ref, lock_name)
                    if text is not None:
                        contents[lock_name] = text
        else:
            for workspace_path in self._resolve_workspace_package_json_paths(
                mcp_client, owner, repo, ref, root_package_json_text
            ):
                text = self._read_file_text(
                    mcp_client, owner, repo, ref, workspace_path
                )
                if text is not None:
                    contents[workspace_path] = text

        return contents

    def _read_readme(
        self, mcp_client: Any, owner: str, repo: str, ref: str | None = None
    ) -> str | None:
        """Fetch the repository README text at ``ref``, or None if unavailable.

        Pinning to the PR head ref keeps ``project_summary`` reproducible and
        reflects README changes made on the PR branch rather than the moving
        default branch.

        Returns:
            The README text at ``ref``, or ``None`` if unavailable.
        """
        return self._read_file_text(mcp_client, owner, repo, ref, "README.md")

    def _build_model(self) -> Model:
        """Build the model for README summarisation.

        Returns:
            Model: Configured via :func:`create_model_provider` for this
            collector's ``provider_type``.
        """
        return create_model_provider(
            self._provider_type,
            self._model_id,
            llm_base_url=self._llm_base_url,
            temperature=0.3,
        )

    def _summarize_readme(self, readme_text: str) -> str:
        """Summarise the README with a single tool-free LLM call.

        Returns:
            The 2-4 sentence plain-prose summary produced by the LLM.
        """
        agent = Agent(model=self._build_model(), system_prompt=SUMMARY_SYSTEM_PROMPT)
        result = agent(
            readme_text[:_README_MAX_CHARS],
            limits={"turns": self._max_agent_turns},
        )
        return str(result).strip()
