"""PR Info Collector agent.

Collects pull request information from GitHub and returns structured data
for use by downstream review agents.
"""

from strands import Agent
from strands.models.openai import OpenAIModel

from ..models.pr_info import PRInfoResult
from ..tools.github_mcp import GITHUB_MCP_URL, create_github_mcp_client

SYSTEM_PROMPT = """\
Please generate summary information from GitHub based on the repository and PR \
number specified by the user, and output it in a structured JSON format.

The output results will be used in subsequent code reviews by multiple agents, \
so please do not include any guesswork.
The information used by subsequent agents includes `repository information` \
(owner, repository name), `project summary` (generated based on the README.md \
file in the repository root), `PR information` (PR title, body, labels, \
file changes), and `dependency files` (paths of dependency manifest files \
changed in the PR, such as package.json, pyproject.toml, requirements.txt).
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
    return ext.lower() in _TARGET_EXTENSIONS or filename in _TARGET_FILENAMES


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
        llm_base_url: str | None = None,
    ) -> None:
        self._github_token = github_token
        self._model_id = model_id
        self._mcp_url = mcp_url
        self._llm_base_url = llm_base_url

    def collect(self, owner: str, repo: str, pr_number: int) -> PRInfoResult:
        """Collect PR information from GitHub and return structured data.

        Connects to the GitHub MCP endpoint, runs the Strands Agent to
        retrieve PR details and README, then returns a validated
        :class:`PRInfoResult`.  File changes are filtered so only
        review-relevant files (as determined by :func:`is_target_file`)
        are included in the result.

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
        if self._llm_base_url:
            openai_model = OpenAIModel(
                model_id=self._model_id,
                client_args={"base_url": self._llm_base_url},
            )
        else:
            openai_model = OpenAIModel(model_id=self._model_id)
        mcp_client = create_github_mcp_client(self._github_token, self._mcp_url)
        with mcp_client:
            agent = Agent(
                model=openai_model,
                system_prompt=SYSTEM_PROMPT,
                tools=[mcp_client],
            )
            result: PRInfoResult = agent.structured_output(
                PRInfoResult,
                prompt=prompt,
            )

        filtered_changes = [
            fc for fc in result.pr_info.file_changes if is_target_file(fc.filePath)
        ]
        return result.model_copy(
            update={
                "pr_info": result.pr_info.model_copy(
                    update={"file_changes": filtered_changes}
                )
            }
        )
