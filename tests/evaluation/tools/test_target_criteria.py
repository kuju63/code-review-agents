"""Tests for evaluation/tools/target_criteria.py."""

from __future__ import annotations

import pytest

from tests.evaluation.conftest import load_eval_tool_module

criteria = load_eval_tool_module("target_criteria", "target_criteria.py")
build_gold_set = load_eval_tool_module("build_gold_set", "build_gold_set.py")


class TestProductionCodeCriteria:
    def test_accepts_frontend_source(self):
        assert criteria.is_production_code_file("src/app.ts") is True

    def test_accepts_package_json(self):
        assert criteria.is_production_code_file("package.json") is True

    def test_rejects_backend_source(self):
        assert criteria.is_production_code_file("backend/app.py") is False

    def test_rejects_frontend_test(self):
        assert criteria.is_production_code_file("src/app.test.ts") is False

    @pytest.mark.parametrize(
        "path",
        ["test.ts", "src/theme.test.scss", "src/layout.spec.css"],
    )
    def test_rejects_generic_test_filename_patterns(self, path):
        assert criteria.is_test_file(path) is True
        assert criteria.is_production_code_file(path) is False

    def test_rejects_root_test_directory(self):
        assert criteria.is_production_code_file("tests/fixture.ts") is False

    def test_normalizes_windows_separators(self):
        assert criteria.is_test_file("src\\__tests__\\a.ts") is True
        assert criteria.is_production_code_file("src\\__tests__\\a.ts") is False

    def test_rejects_documentation(self):
        assert criteria.is_production_code_file("docs/app.ts.md") is False

    def test_rejects_frontend_file_under_root_docs_directory(self):
        assert criteria.is_production_code_file("docs/example.ts") is False

    def test_change_requires_patch_like_gold_builder(self):
        files = [{"filename": "src/app.ts", "patch": None}]
        assert criteria.has_production_code_change(files) is False

    def test_gold_builder_uses_same_predicate(self):
        paths = ["src/app.ts", "src/app.test.ts", "backend/app.py", "package.json"]
        assert [build_gold_set._is_target_file(path) for path in paths] == [
            criteria.is_production_code_file(path) for path in paths
        ]


class TestInlineReviewCriteria:
    def test_accepts_human_inline_comment(self):
        comment = {"body": "fix", "path": "src/app.ts", "user": {"login": "alice"}}
        assert criteria.is_qualifying_inline_comment(comment) is True

    def test_accepts_ai_inline_comment(self):
        comment = {
            "body": "fix",
            "path": "src/app.ts",
            "user": {"login": "coderabbitai[bot]"},
        }
        assert criteria.is_qualifying_inline_comment(comment) is True

    def test_rejects_comment_without_path(self):
        assert criteria.is_qualifying_inline_comment({"body": "fix"}) is False

    def test_rejects_comment_on_non_target_file(self):
        comment = {"body": "fix", "path": "backend/app.py"}
        assert criteria.is_qualifying_inline_comment(comment) is False

    def test_rejects_blank_comment(self):
        comment = {"body": "  ", "path": "src/app.ts"}
        assert criteria.is_qualifying_inline_comment(comment) is False
