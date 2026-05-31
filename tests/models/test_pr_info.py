"""Tests for Pydantic models in pr_info module."""

import pytest
from pydantic import ValidationError

from code_review_agent.models.pr_info import (
    FileChange,
    PRInfo,
    PRInfoResult,
    RepositoryInfo,
)


class TestRepositoryInfo:
    def test_valid(self):
        info = RepositoryInfo(owner="octocat", repository="hello-world")
        assert info.owner == "octocat"
        assert info.repository == "hello-world"

    def test_missing_owner_raises(self):
        with pytest.raises(ValidationError):
            RepositoryInfo(repository="hello-world")  # type: ignore[call-arg]

    def test_missing_repository_raises(self):
        with pytest.raises(ValidationError):
            RepositoryInfo(owner="octocat")  # type: ignore[call-arg]


class TestFileChange:
    def test_valid(self):
        fc = FileChange(filePath="src/index.ts", patch="@@ -1,1 +1,2 @@\n+import x")
        assert fc.filePath == "src/index.ts"
        assert "@@ -1,1" in fc.patch  # type: ignore[operator]

    def test_patch_none(self):
        fc = FileChange(filePath="image.png")
        assert fc.patch is None

    def test_missing_filepath_raises(self):
        with pytest.raises(ValidationError):
            FileChange()  # type: ignore[call-arg]


class TestPRInfo:
    def test_valid_with_defaults(self):
        pr = PRInfo(title="Fix bug", pr_number=42, body="Fixes #41")
        assert pr.title == "Fix bug"
        assert pr.pr_number == 42
        assert pr.body == "Fixes #41"
        assert pr.labels == []
        assert pr.file_changes == []

    def test_body_none(self):
        pr = PRInfo(title="No desc", pr_number=1)
        assert pr.body is None

    def test_with_labels_and_changes(self):
        fc = FileChange(filePath="src/App.tsx", patch="@@ -1 +1 @@\n-old\n+new")
        pr = PRInfo(
            title="Feature",
            pr_number=1,
            body="",
            labels=["enhancement"],
            file_changes=[fc],
        )
        assert pr.labels == ["enhancement"]
        assert len(pr.file_changes) == 1
        assert pr.file_changes[0].filePath == "src/App.tsx"

    def test_invalid_pr_number_type(self):
        with pytest.raises(ValidationError):
            PRInfo(title="T", pr_number="not-an-int", body="")  # type: ignore[arg-type]


class TestPRInfoResult:
    def _make_result(self) -> PRInfoResult:
        repo = RepositoryInfo(owner="owner", repository="repo")
        fc = FileChange(filePath="src/main.ts", patch="@@ -1 +1 @@\n-a\n+b")
        pr = PRInfo(title="PR", pr_number=10, body="body", labels=[], file_changes=[fc])
        return PRInfoResult(
            repository_info=repo,
            project_summary="A sample project.",
            pr_info=pr,
            dependency_files=["package.json"],
        )

    def test_valid(self):
        result = self._make_result()
        assert result.repository_info.owner == "owner"
        assert result.project_summary == "A sample project."
        assert result.pr_info.pr_number == 10
        assert result.dependency_files == ["package.json"]

    def test_dependency_files_default_empty(self):
        repo = RepositoryInfo(owner="o", repository="r")
        pr = PRInfo(title="T", pr_number=1)
        result = PRInfoResult(
            repository_info=repo,
            project_summary="Summary.",
            pr_info=pr,
        )
        assert result.dependency_files == []

    def test_json_round_trip(self):
        result = self._make_result()
        data = result.model_dump()
        restored = PRInfoResult.model_validate(data)
        assert restored == result

    def test_missing_required_fields_raise(self):
        with pytest.raises(ValidationError):
            PRInfoResult(  # type: ignore[call-arg]
                repository_info=RepositoryInfo(owner="o", repository="r"),
                pr_info=PRInfo(title="T", pr_number=1),
                # project_summary intentionally omitted
            )
