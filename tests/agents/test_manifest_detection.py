"""Tests for content-based project-type detection (Issue #230)."""

import json

from code_review_agent.agents.manifest_detection import (
    collect_direct_package_names,
    detect_project_type_from_packages,
    extract_direct_dependencies_from_package_json,
    extract_direct_dependencies_from_package_lock,
    extract_direct_dependencies_from_pnpm_lock,
)
from code_review_agent.models.review import ProjectType


class TestExtractDirectDependenciesFromPackageJson:
    def test_union_of_dependencies_and_dev_dependencies(self):
        content = json.dumps(
            {"dependencies": {"react": "^19.0.0"}, "devDependencies": {"vitest": "^4"}}
        )
        assert extract_direct_dependencies_from_package_json(content) == {
            "react",
            "vitest",
        }

    def test_missing_fields_returns_empty_set(self):
        assert extract_direct_dependencies_from_package_json("{}") == set()

    def test_invalid_json_returns_empty_set(self):
        assert extract_direct_dependencies_from_package_json("not json") == set()

    def test_only_dependencies_field(self):
        content = json.dumps({"dependencies": {"vue": "^3"}})
        assert extract_direct_dependencies_from_package_json(content) == {"vue"}

    def test_non_object_json_returns_empty_set(self):
        assert extract_direct_dependencies_from_package_json("[1, 2, 3]") == set()


class TestExtractDirectDependenciesFromPackageLock:
    def test_root_entry_dependencies_and_dev_dependencies(self):
        content = json.dumps(
            {
                "lockfileVersion": 3,
                "packages": {
                    "": {
                        "dependencies": {"nuxt": "^4.5.1"},
                        "devDependencies": {"vitest": "^4"},
                    },
                    "node_modules/react": {"version": "19.0.0"},
                },
            }
        )
        assert extract_direct_dependencies_from_package_lock(content) == {
            "nuxt",
            "vitest",
        }

    def test_transitive_only_packages_are_not_included(self):
        # A transitive dep (react, pulled in by some devtool) must not leak
        # into the direct-dependency set merely by appearing as a
        # node_modules/* key.
        content = json.dumps(
            {
                "packages": {
                    "": {"dependencies": {"vue": "^3"}},
                    "node_modules/react": {"version": "19.0.0"},
                }
            }
        )
        assert extract_direct_dependencies_from_package_lock(content) == {"vue"}

    def test_missing_root_entry_returns_empty_set(self):
        content = json.dumps({"packages": {"node_modules/react": {}}})
        assert extract_direct_dependencies_from_package_lock(content) == set()

    def test_invalid_json_returns_empty_set(self):
        assert extract_direct_dependencies_from_package_lock("not json") == set()

    def test_non_object_json_returns_empty_set(self):
        assert extract_direct_dependencies_from_package_lock("[1, 2, 3]") == set()


class TestExtractDirectDependenciesFromPnpmLock:
    def test_importers_root_dependencies_and_dev_dependencies(self):
        content = """
importers:
  .:
    dependencies:
      vue:
        specifier: ^3.5.40
        version: 3.5.40
    devDependencies:
      vitest:
        specifier: ^4.1.8
        version: 4.1.8
"""
        assert extract_direct_dependencies_from_pnpm_lock(content) == {
            "vue",
            "vitest",
        }

    def test_top_level_fallback_for_non_workspace_project(self):
        content = """
dependencies:
  react:
    specifier: ^19.0.0
    version: 19.0.0
"""
        assert extract_direct_dependencies_from_pnpm_lock(content) == {"react"}

    def test_invalid_yaml_returns_empty_set(self):
        assert extract_direct_dependencies_from_pnpm_lock(":: not yaml ::") == set()

    def test_empty_content_returns_empty_set(self):
        assert extract_direct_dependencies_from_pnpm_lock("") == set()

    def test_importers_root_entry_not_a_mapping_returns_empty_set(self):
        content = "importers:\n  .: not-a-mapping\n"
        assert extract_direct_dependencies_from_pnpm_lock(content) == set()


class TestDetectProjectTypeFromPackages:
    def test_angular(self):
        assert (
            detect_project_type_from_packages({"@angular/core", "rxjs"})
            is ProjectType.ANGULAR
        )

    def test_svelte_bare_package(self):
        assert detect_project_type_from_packages({"svelte"}) is ProjectType.SVELTE

    def test_svelte_via_sveltejs_kit_scope(self):
        # svelte-seeded's real package.json has no bare "svelte" dependency,
        # only @sveltejs/kit and friends.
        assert (
            detect_project_type_from_packages({"@sveltejs/kit", "vite"})
            is ProjectType.SVELTE
        )

    def test_nuxt_takes_priority_over_vue(self):
        assert (
            detect_project_type_from_packages({"nuxt", "vue", "pinia"})
            is ProjectType.NUXT
        )

    def test_vue_without_nuxt(self):
        assert detect_project_type_from_packages({"vue"}) is ProjectType.VUE

    def test_next_takes_priority_over_react(self):
        assert (
            detect_project_type_from_packages({"next", "react", "react-dom"})
            is ProjectType.NEXTJS
        )

    def test_react_without_next(self):
        assert detect_project_type_from_packages({"react"}) is ProjectType.REACT_TS

    def test_no_known_package_returns_none(self):
        assert detect_project_type_from_packages({"lodash", "zod"}) is None

    def test_empty_set_returns_none(self):
        assert detect_project_type_from_packages(set()) is None


class TestCollectDirectPackageNames:
    def test_package_json_only(self):
        manifests = {"package.json": json.dumps({"dependencies": {"vue": "^3"}})}
        assert collect_direct_package_names(manifests) == {"vue"}

    def test_unions_across_workspace_package_json_files(self):
        manifests = {
            "package.json": json.dumps({"dependencies": {}}),
            "packages/web/package.json": json.dumps({"dependencies": {"react": "^19"}}),
            "packages/admin/package.json": json.dumps({"dependencies": {"vue": "^3"}}),
        }
        assert collect_direct_package_names(manifests) == {"react", "vue"}

    def test_falls_back_to_package_lock_when_no_package_json_present(self):
        lock_content = json.dumps({"packages": {"": {"dependencies": {"nuxt": "^4"}}}})
        manifests = {"package-lock.json": lock_content}
        assert collect_direct_package_names(manifests) == {"nuxt"}

    def test_falls_back_to_pnpm_lock_when_no_package_json_present(self):
        manifests = {"pnpm-lock.yaml": "dependencies:\n  vue:\n    version: 3\n"}
        assert collect_direct_package_names(manifests) == {"vue"}

    def test_does_not_fall_back_when_package_json_yields_names(self):
        manifests = {
            "package.json": json.dumps({"dependencies": {"vue": "^3"}}),
            "package-lock.json": json.dumps(
                {"packages": {"": {"dependencies": {"react": "^19"}}}}
            ),
        }
        assert collect_direct_package_names(manifests) == {"vue"}

    def test_empty_manifests_returns_empty_set(self):
        assert collect_direct_package_names({}) == set()
