"""Pydantic models for PR information collected from GitHub."""

from pydantic import BaseModel, Field


class RepositoryInfo(BaseModel):
    """Repository owner and name.

    Attributes:
        owner: GitHub repository owner (user or organization).
        repository: Repository name.
    """

    owner: str = Field(..., description="GitHub repository owner")
    repository: str = Field(..., description="Repository name")


class FileChange(BaseModel):
    """Diff information for a single changed file.

    Attributes:
        filePath: Relative path to the changed file within the repository.
        patch: Unified diff patch string for the file.
    """

    filePath: str = Field(..., description="Relative path of the changed file")
    patch: str = Field(..., description="Unified diff patch for the file")


class PRInfo(BaseModel):
    """Pull request metadata and file changes.

    Attributes:
        title: PR title.
        pr_number: PR number.
        body: PR description body.
        labels: List of label names attached to the PR.
        file_changes: List of changed files with diff patches.
    """

    title: str = Field(..., description="PR title")
    pr_number: int = Field(..., description="PR number")
    body: str = Field(..., description="PR body description")
    labels: list[str] = Field(default_factory=list, description="PR labels")
    file_changes: list[FileChange] = Field(
        default_factory=list,
        description="Changed files with diff patches",
    )


class PRInfoResult(BaseModel):
    """Structured result from the PR Info Collector agent.

    Attributes:
        repository_info: Owner and repository name.
        project_summary: Summary generated from the repository README.
        pr_info: PR metadata and file changes.
    """

    repository_info: RepositoryInfo = Field(..., description="Repository information")
    project_summary: str = Field(..., description="Project summary from README")
    pr_info: PRInfo = Field(..., description="PR information and file changes")
