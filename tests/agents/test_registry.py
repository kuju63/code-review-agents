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


def _pr_info(
    *,
    file_paths: list[str],
    dependency_files: list[str],
    manifest_contents: dict[str, str] | None = None,
) -> PRInfoResult:
    return PRInfoResult(
        repository_info=RepositoryInfo(owner="o", repository="r"),
        project_summary="s",
        pr_info=PRInfo(
            title="t",
            pr_number=1,
            file_changes=[FileChange(filePath=p) for p in file_paths],
        ),
        dependency_files=dependency_files,
        manifest_contents=manifest_contents or {},
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

    def test_detects_vue_from_vue_file_change(self):
        pr = _pr_info(file_paths=["src/App.vue"], dependency_files=[])
        assert detect_project_types(pr) == {ProjectType.VUE}

    def test_detects_vue_from_vue_config_js_dependency_file(self):
        pr = _pr_info(
            file_paths=["src/lib/util.ts"], dependency_files=["vue.config.js"]
        )
        assert detect_project_types(pr) == {ProjectType.VUE}

    def test_detects_vue_from_vue_config_ts_change(self):
        pr = _pr_info(file_paths=["vue.config.ts"], dependency_files=[])
        assert detect_project_types(pr) == {ProjectType.VUE}

    def test_vue_detection_suppresses_coarse_react_detection(self):
        pr = _pr_info(
            file_paths=["src/App.vue", "src/lib/util.ts"],
            dependency_files=["package.json"],
        )
        assert detect_project_types(pr) == {ProjectType.VUE}

    def test_angular_detection_takes_priority_over_vue(self):
        pr = _pr_info(
            file_paths=["src/app/app.component.ts", "src/App.vue"],
            dependency_files=["angular.json", "vue.config.js"],
        )
        assert detect_project_types(pr) == {ProjectType.ANGULAR}

    def test_svelte_detection_takes_priority_over_vue(self):
        pr = _pr_info(
            file_paths=["src/App.svelte", "src/App.vue"],
            dependency_files=["svelte.config.js", "vue.config.js"],
        )
        assert detect_project_types(pr) == {ProjectType.SVELTE}

    def test_does_not_match_filename_that_only_ends_with_package_json_text(self):
        # ``package.json`` detection must be as strict as the manifest checks:
        # a file whose name merely ends with the manifest text is not a match.
        pr = _pr_info(file_paths=["not-package.json"], dependency_files=[])
        assert detect_project_types(pr) == set()

    def test_detects_react_from_nested_package_json_change(self):
        pr = _pr_info(file_paths=["packages/web/package.json"], dependency_files=[])
        assert detect_project_types(pr) == {ProjectType.REACT_TS}

    def test_svelte_detection_takes_priority_over_react(self):
        pr = _pr_info(
            file_paths=["src/App.svelte", "src/main.ts", "package.json"],
            dependency_files=["package.json", "svelte.config.js"],
        )
        assert detect_project_types(pr) == {ProjectType.SVELTE}

    @pytest.mark.parametrize(
        ("file_paths", "dependency_files", "expected"),
        [
            (["a.component.ts", "b.svelte"], ["package.json"], ProjectType.ANGULAR),
            (["b.svelte", "c.ts"], ["package.json"], ProjectType.SVELTE),
            (["c.ts"], ["package.json"], ProjectType.REACT_TS),
            (
                ["a.component.ts"],
                ["angular.json", "svelte.config.js"],
                ProjectType.ANGULAR,
            ),
            (["x.svelte"], ["svelte.config.ts", "package.json"], ProjectType.SVELTE),
            (["x.vue", "c.ts"], ["package.json"], ProjectType.VUE),
            (["x.vue"], ["vue.config.ts", "package.json"], ProjectType.VUE),
        ],
    )
    def test_detection_priority_matrix(self, file_paths, dependency_files, expected):
        pr = _pr_info(file_paths=file_paths, dependency_files=dependency_files)
        assert detect_project_types(pr) == {expected}

    def test_no_detection_without_ts_js_or_manifest(self):
        pr = _pr_info(file_paths=["styles/main.css", "index.html"], dependency_files=[])
        assert detect_project_types(pr) == set()


class TestDetectProjectTypesFromManifestContent:
    """Tier 2: package.json/lock-file content resolves what the coarse
    extension fallback (Tier 3) cannot -- Vue/Nuxt/Next.js projects whose
    changed files carry no distinguishing extension, and metaframeworks
    that share their base framework's extensions entirely."""

    def test_detects_vue_from_package_json_content_without_vue_file(self):
        pr = _pr_info(
            file_paths=["src/util.ts"],
            dependency_files=["package.json"],
            manifest_contents={"package.json": '{"dependencies": {"vue": "^3.5.40"}}'},
        )
        assert detect_project_types(pr) == {ProjectType.VUE}

    def test_nuxt_takes_priority_over_vue_from_content(self):
        # Mirrors kuju63/vue-seeded's real package.json: labelled "vue" but
        # actually a Nuxt app (Issue #238).
        pr = _pr_info(
            file_paths=["src/util.ts"],
            dependency_files=["package.json"],
            manifest_contents={
                "package.json": (
                    '{"dependencies": {"nuxt": "^4.5.1", "vue": "^3.5.40"}}'
                )
            },
        )
        assert detect_project_types(pr) == {ProjectType.NUXT}

    def test_nextjs_takes_priority_over_react_from_content(self):
        # Mirrors kuju63/react-seeded's real package.json: labelled "react"
        # but actually a Next.js app.
        pr = _pr_info(
            file_paths=["src/util.ts"],
            dependency_files=["package.json"],
            manifest_contents={
                "package.json": '{"dependencies": {"next": "16.2.12", "react": "19.2.4"}}'
            },
        )
        assert detect_project_types(pr) == {ProjectType.NEXTJS}

    def test_detects_svelte_from_sveltejs_kit_content_without_svelte_file(self):
        # Mirrors kuju63/svelte-seeded's real package.json: no bare "svelte"
        # dependency, only @sveltejs/kit -- and no svelte.config.js/.ts at
        # all, so Tier 1 has no signal either (Issue #238).
        pr = _pr_info(
            file_paths=["src/util.ts"],
            dependency_files=["package.json"],
            manifest_contents={
                "package.json": '{"devDependencies": {"@sveltejs/kit": "^2.63.0"}}'
            },
        )
        assert detect_project_types(pr) == {ProjectType.SVELTE}

    def test_detects_angular_from_content_without_extension_signal(self):
        pr = _pr_info(
            file_paths=["src/main.ts"],
            dependency_files=["package.json"],
            manifest_contents={
                "package.json": '{"dependencies": {"@angular/core": "^22.1.0"}}'
            },
        )
        assert detect_project_types(pr) == {ProjectType.ANGULAR}

    def test_tier1_extension_match_wins_over_conflicting_content(self):
        # A .svelte file change is Tier 1 and returns immediately, before
        # manifest content (which here would otherwise resolve to React) is
        # even consulted.
        pr = _pr_info(
            file_paths=["src/App.svelte"],
            dependency_files=["package.json"],
            manifest_contents={"package.json": '{"dependencies": {"react": "19.2.4"}}'},
        )
        assert detect_project_types(pr) == {ProjectType.SVELTE}

    def test_aggregates_workspace_package_json_content(self):
        pr = _pr_info(
            file_paths=["packages/web/src/index.ts"],
            dependency_files=["package.json"],
            manifest_contents={
                "package.json": "{}",
                "packages/web/package.json": '{"dependencies": {"vue": "^3"}}',
            },
        )
        assert detect_project_types(pr) == {ProjectType.VUE}

    def test_unknown_package_falls_through_to_coarse_react_fallback(self):
        pr = _pr_info(
            file_paths=["src/util.ts"],
            dependency_files=["package.json"],
            manifest_contents={
                "package.json": '{"dependencies": {"lodash": "^4.17.21"}}'
            },
        )
        assert detect_project_types(pr) == {ProjectType.REACT_TS}


class TestMetaframeworkReviewerFallback:
    """get_reviewer_classes routes NEXTJS/NUXT to the base framework's
    reviewers, since no dedicated Next.js/Nuxt reviewer is registered."""

    def test_nextjs_selects_react_reviewer(self, clean_registry):
        @register_reviewer
        class _React(LLMReviewAgent):
            reviewer_id = "react-technical"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            system_prompt = "x"

        assert _React in get_reviewer_classes(ProjectType.NEXTJS)

    def test_nuxt_selects_vue_reviewer(self, clean_registry):
        @register_reviewer
        class _Vue(LLMReviewAgent):
            reviewer_id = "vue-technical"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.VUE})
            system_prompt = "x"

        assert _Vue in get_reviewer_classes(ProjectType.NUXT)

    def test_nextjs_selects_security_reviewer_shared_with_react(self, clean_registry):
        @register_reviewer
        class _Security(LLMReviewAgent):
            reviewer_id = "security"
            perspective = ReviewPerspective.SECURITY
            project_types = frozenset({ProjectType.REACT_TS, ProjectType.VUE})
            system_prompt = "x"

        assert _Security in get_reviewer_classes(ProjectType.NEXTJS)
        assert _Security in get_reviewer_classes(ProjectType.NUXT)

    def test_non_metaframework_type_has_no_fallback(self, clean_registry):
        @register_reviewer
        class _React(LLMReviewAgent):
            reviewer_id = "react-technical"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            system_prompt = "x"

        assert get_reviewer_classes(ProjectType.SPRING_BOOT) == []

    def test_reviewer_registered_directly_for_nextjs_is_also_selected(
        self, clean_registry
    ):
        @register_reviewer
        class _Next(LLMReviewAgent):
            reviewer_id = "next-technical"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.NEXTJS})
            system_prompt = "x"

        @register_reviewer
        class _React(LLMReviewAgent):
            reviewer_id = "react-technical"
            perspective = ReviewPerspective.TECHNICAL
            project_types = frozenset({ProjectType.REACT_TS})
            system_prompt = "x"

        selected = get_reviewer_classes(ProjectType.NEXTJS)
        assert _Next in selected
        assert _React in selected
