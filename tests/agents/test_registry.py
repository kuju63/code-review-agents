"""Tests for the reviewer registry and project-type detection."""

from collections.abc import Iterator

import pytest

from code_review_agent.agents import registry
from code_review_agent.agents.base_reviewer import LLMReviewAgent
from code_review_agent.agents.registry import (
    detect_project_types,
    get_reviewer_classes,
    register_reviewer,
)
from code_review_agent.models.pr_info import (
    FileChange,
    PRInfo,
    PRInfoResult,
    RepositoryInfo,
)
from code_review_agent.models.review import ProjectType, ReviewPerspective


@pytest.fixture
def clean_registry() -> Iterator[None]:
    """Snapshot and restore the module-level registry around each test."""
    saved = registry.get_registered_reviewers()
    registry._REGISTRY.clear()
    yield
    registry._REGISTRY.clear()
    registry._REGISTRY.extend(saved)


def _pr_info(*, file_paths: list[str], dependency_files: list[str]) -> PRInfoResult:
    return PRInfoResult(
        repository_info=RepositoryInfo(owner="o", repository="r"),
        project_summary="s",
        pr_info=PRInfo(
            title="t",
            pr_number=1,
            file_changes=[FileChange(filePath=p) for p in file_paths],
        ),
        dependency_files=dependency_files,
    )


class TestRegistration:
    """register_reviewer adds classes; get_reviewer_classes selects them."""

    def test_register_and_select_by_project_type(self, clean_registry):
        @register_reviewer
        class _Tech(LLMReviewAgent):
            reviewer_id = "react-tech"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            system_prompt = "x"

        selected = get_reviewer_classes(ProjectType.REACT_TS)
        assert _Tech in selected

    def test_select_excludes_other_project_types(self, clean_registry):
        @register_reviewer
        class _Tech(LLMReviewAgent):
            reviewer_id = "react-tech"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            system_prompt = "x"

        assert get_reviewer_classes(ProjectType.SPRING_BOOT) == []

    def test_perspective_filter(self, clean_registry):
        @register_reviewer
        class _Tech(LLMReviewAgent):
            reviewer_id = "react-tech"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            system_prompt = "x"

        @register_reviewer
        class _Sec(LLMReviewAgent):
            reviewer_id = "react-sec"
            perspective = ReviewPerspective.SECURITY
            project_types = frozenset({ProjectType.REACT_TS})
            system_prompt = "x"

        only_sec = get_reviewer_classes(
            ProjectType.REACT_TS, perspectives={ReviewPerspective.SECURITY}
        )
        assert only_sec == [_Sec]

    def test_reviewer_can_target_multiple_project_types(self, clean_registry):
        @register_reviewer
        class _Shared(LLMReviewAgent):
            reviewer_id = "shared-sec"
            perspective = ReviewPerspective.SECURITY
            project_types = frozenset({ProjectType.REACT_TS, ProjectType.NEXTJS})
            system_prompt = "x"

        assert _Shared in get_reviewer_classes(ProjectType.REACT_TS)
        assert _Shared in get_reviewer_classes(ProjectType.NEXTJS)

    def test_decorator_returns_class(self, clean_registry):
        @register_reviewer
        class _Tech(LLMReviewAgent):
            reviewer_id = "r"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            system_prompt = "x"

        assert _Tech.reviewer_id == "r"


class TestDetectProjectTypes:
    """detect_project_types infers stacks from PR info."""

    def test_detects_react_ts(self):
        pr = _pr_info(
            file_paths=["src/App.tsx", "src/util.ts"],
            dependency_files=["package.json"],
        )
        assert ProjectType.REACT_TS in detect_project_types(pr)

    def test_detects_react_with_package_json_in_changes(self):
        pr = _pr_info(
            file_paths=["src/App.jsx", "package.json"],
            dependency_files=[],
        )
        assert ProjectType.REACT_TS in detect_project_types(pr)

    def test_detects_react_from_tsx_only(self):
        # A PR touching only src/*.tsx changes no manifest; detection must
        # still recognise it as React/TypeScript.
        pr = _pr_info(file_paths=["src/App.tsx"], dependency_files=[])
        assert detect_project_types(pr) == {ProjectType.REACT_TS}

    def test_detects_react_from_package_json_only(self):
        # A dependency bump (package.json only) qualifies on its own.
        pr = _pr_info(file_paths=["styles/main.css"], dependency_files=["package.json"])
        assert detect_project_types(pr) == {ProjectType.REACT_TS}

    def test_detects_angular_from_angular_json_dependency_file(self):
        pr = _pr_info(file_paths=["styles/main.css"], dependency_files=["angular.json"])
        assert detect_project_types(pr) == {ProjectType.ANGULAR}

    def test_detects_angular_from_angular_json_change(self):
        pr = _pr_info(file_paths=["angular.json"], dependency_files=[])
        assert detect_project_types(pr) == {ProjectType.ANGULAR}

    def test_does_not_match_filename_that_only_ends_with_angular_json_text(self):
        pr = _pr_info(file_paths=["not-angular.json"], dependency_files=[])
        assert detect_project_types(pr) == set()

    @pytest.mark.parametrize(
        "file_path",
        [
            "src/app/app.component.ts",
            "src/app/user.service.ts",
            "src/app/menu.directive.ts",
            "src/app/date.pipe.ts",
        ],
    )
    def test_detects_angular_from_file_naming_conventions(self, file_path):
        pr = _pr_info(file_paths=[file_path], dependency_files=[])
        assert detect_project_types(pr) == {ProjectType.ANGULAR}

    def test_angular_detection_suppresses_coarse_react_detection(self):
        pr = _pr_info(
            file_paths=["src/app/app.component.ts", "package.json"],
            dependency_files=["package.json", "angular.json"],
        )
        assert detect_project_types(pr) == {ProjectType.ANGULAR}

    def test_detects_svelte_from_svelte_file_change(self):
        pr = _pr_info(file_paths=["src/App.svelte"], dependency_files=[])
        assert detect_project_types(pr) == {ProjectType.SVELTE}

    def test_detects_svelte_from_svelte_config_js_dependency_file(self):
        pr = _pr_info(
            file_paths=["src/lib/util.ts"], dependency_files=["svelte.config.js"]
        )
        assert detect_project_types(pr) == {ProjectType.SVELTE}

    def test_detects_svelte_from_svelte_config_ts_change(self):
        pr = _pr_info(file_paths=["svelte.config.ts"], dependency_files=[])
        assert detect_project_types(pr) == {ProjectType.SVELTE}

    def test_svelte_detection_suppresses_coarse_react_detection(self):
        pr = _pr_info(
            file_paths=["src/App.svelte", "src/lib/util.ts"],
            dependency_files=["package.json"],
        )
        assert detect_project_types(pr) == {ProjectType.SVELTE}

    def test_angular_detection_takes_priority_over_svelte(self):
        pr = _pr_info(
            file_paths=["src/app/app.component.ts", "src/App.svelte"],
            dependency_files=["angular.json", "svelte.config.js"],
        )
        assert detect_project_types(pr) == {ProjectType.ANGULAR}

    def test_no_detection_without_ts_js_or_manifest(self):
        pr = _pr_info(file_paths=["styles/main.css", "index.html"], dependency_files=[])
        assert detect_project_types(pr) == set()
