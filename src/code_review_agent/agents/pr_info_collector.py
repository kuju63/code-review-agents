"""PR Info Collector agent.

Collects pull request information from GitHub and returns structured data
for use by downstream review agents.
"""

import functools

from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models.openai import OpenAIModel
from strands.tools.mcp import MCPClient

from ..models.pr_info import PRInfoResult

GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/read-only"

SYSTEM_PROMPT = """\
Please generate summary information from GitHub based on the repository and PR \
number specified by the user, and output it in a structured JSON format.

The output results will be used in subsequent code reviews by multiple agents, \
so please do not include any guesswork.
The information used by subsequent agents includes `repository information` \
(owner, repository name), `project summary` (generated based on the README.md \
file in the repository root), and `PR information` (PR title, body, labels, \
file changes).
File changes are limited to TypeScript/JavaScript files (.ts, .tsx, .js, .jsx), \
CSS/SCSS files (.css, .scss), HTML files (.html), and package.json files. \
All changed lines and details must be comprehensively covered for each file.
You must use a tool to retrieve information from GitHub.
"""

_COLLECT_PROMPT_TEMPLATE = (
    "Please collect PR info for the repository {owner}/{repo}, PR #{pr_number}."
)

_TARGET_EXTENSIONS = frozenset([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html"])
_TARGET_FILENAMES = frozenset(["package.json"])


def is_target_file(file_path: str) -> bool:
    """Return True if the file should be included in the review.

    Includes TypeScript/JavaScript, CSS/SCSS, HTML, and package.json files.

    Args:
        file_path: Relative path to the file within the repository.

    Returns:
        True when the file matches a target extension or filename.
    """
    import os

    _, ext = os.path.splitext(file_path)
    filename = os.path.basename(file_path)
    return ext.lower() in _TARGET_EXTENSIONS or filename == "package.json"


class PRInfoCollector:
    """Agent that collects PR information from GitHub.

    Uses Strands Agent with GitHub MCP tools to retrieve PR details,
    project README summary, and per-file diff patches for review-relevant
    file types.

    Args:
        github_token: GitHub personal access token or Copilot token.
        model_id: OpenAI-compatible model ID to use for the agent.
        mcp_url: URL of the GitHub MCP endpoint.
    """

    def __init__(
        self,
        github_token: str,
        model_id: str = "gpt-4o",
        mcp_url: str = GITHUB_MCP_URL,
    ) -> None:
        self._github_token = github_token
        self._model_id = model_id
        self._mcp_url = mcp_url

    def _create_mcp_client(self) -> MCPClient:
        """Create a new MCPClient connected to GitHub MCP.

        Returns:
            Configured MCPClient instance.
        """
        token = self._github_token
        url = self._mcp_url
        return MCPClient(
            functools.partial(
                streamablehttp_client,
                url=url,
                headers={"Authorization": f"Bearer {token}"},
            )
        )

    def collect(self, owner: str, repo: str, pr_number: int) -> PRInfoResult:
        """Collect PR information from GitHub and return structured data.

        Connects to the GitHub MCP endpoint, runs the Strands Agent to
        retrieve PR details and README, then returns a validated
        :class:`PRInfoResult`.

        Args:
            owner: Repository owner (user or organization name).
            repo: Repository name.
            pr_number: Pull request number.

        Returns:
            Structured PR information ready for downstream review agents.
        """
        prompt = _COLLECT_PROMPT_TEMPLATE.format(
            owner=owner, repo=repo, pr_number=pr_number
        )
        mcp_client = self._create_mcp_client()
        with mcp_client:
            agent = Agent(
                model=OpenAIModel(model_id=self._model_id),
                system_prompt=SYSTEM_PROMPT,
                tools=[mcp_client],
            )
            result: PRInfoResult = agent.structured_output(
                PRInfoResult,
                prompt=prompt,
            )
        return result
