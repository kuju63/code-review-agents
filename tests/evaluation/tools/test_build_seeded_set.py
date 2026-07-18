"""Tests for evaluation/tools/build_seeded_set.py.

Covers: prod-file candidate selection, (file, rule) combo pool enumeration,
and the without-replacement sampling in build_seeded_items -- in particular
the no-duplicate-combo guarantee that regression-tests Issue #94 (duplicate
Seeded items generated under --multiplier >= 2).
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from tests.evaluation.conftest import load_eval_tool_module

build_seeded_set = load_eval_tool_module("build_seeded_set", "build_seeded_set.py")

candidate_files = build_seeded_set.candidate_files
enumerate_combo_pool = build_seeded_set.enumerate_combo_pool
render_seeded_item = build_seeded_set.render_seeded_item
build_seeded_items = build_seeded_set.build_seeded_items
main = build_seeded_set.main
inject_patch = build_seeded_set.inject_patch
get_snippet_for_lang = build_seeded_set.get_snippet_for_lang
split_hunks = build_seeded_set.split_hunks
select_target_hunk = build_seeded_set.select_target_hunk
parse_hunk_new_start = build_seeded_set.parse_hunk_new_start
count_new_lines_before = build_seeded_set.count_new_lines_before
find_insertion_point = build_seeded_set.find_insertion_point
validate_catalog = build_seeded_set.validate_catalog
verify_diff_parses = build_seeded_set.verify_diff_parses
verify_only_additions_changed = build_seeded_set.verify_only_additions_changed
verify_required_tokens = build_seeded_set.verify_required_tokens
verify_runtime_consistency = build_seeded_set.verify_runtime_consistency
recompute_injected_line = build_seeded_set.recompute_injected_line
MutatedPatchOutput = build_seeded_set.MutatedPatchOutput
build_generation_prompt = build_seeded_set.build_generation_prompt
make_llm_mutation_generator = build_seeded_set.make_llm_mutation_generator
passes_post_generation_checks = build_seeded_set.passes_post_generation_checks
render_seeded_item_from_llm = build_seeded_set.render_seeded_item_from_llm
render_seeded_item_with_generation = build_seeded_set.render_seeded_item_with_generation

RULES = [
    {
        "rule_id": "rule_a",
        "languages": ["js", "ts"],
        "runtime": "universal",
        "category": "security",
        "severity": "high",
        "summary": "Rule A summary",
        "required_tokens": [r"\beval\("],
        "line_snippet": "eval(userInput);",
        "language_snippets": {
            "js": "eval(userInput);",
            "ts": "eval(userInput);",
        },
    },
    {
        "rule_id": "rule_b",
        "languages": ["js"],
        "runtime": "browser",
        "category": "security",
        "severity": "medium",
        "summary": "Rule B summary",
        "required_tokens": [r"\.innerHTML\b"],
        "line_snippet": "el.innerHTML = data;",
        "language_snippets": {
            "js": "el.innerHTML = data;",
        },
    },
    {
        "rule_id": "rule_c",
        "languages": ["ts"],
        "runtime": "universal",
        "category": "performance",
        "severity": "low",
        "summary": "Rule C summary",
        "required_tokens": [r"\.then\("],
        "line_snippet": "Promise.all(items.map(fn)).then(() => {});",
        "language_snippets": {
            "ts": "Promise.all(items.map(fn)).then(() => {});",
        },
    },
]


def make_file(path, patch="@@ -1,2 +1,2 @@\n line1\n line2"):
    return {"path": path, "patch": patch}


def make_gold_item(id="owner/repo#1", files=None):
    return {
        "id": id,
        "repository": "owner/repo",
        "pr_number": 1,
        "file_changes": files or [],
    }


class TestCandidateFiles:
    def test_prefers_prod_over_test_files(self):
        item = make_gold_item(
            files=[make_file("src/foo.ts"), make_file("src/foo.test.ts")]
        )
        result = candidate_files(item)
        assert [f["path"] for f in result] == ["src/foo.ts"]

    def test_falls_back_to_all_files_when_only_test_files(self):
        item = make_gold_item(files=[make_file("src/foo.test.ts")])
        result = candidate_files(item)
        assert [f["path"] for f in result] == ["src/foo.test.ts"]


class TestEnumerateComboPool:
    def test_pool_size_is_sum_of_matching_rules_not_product(self):
        item = make_gold_item(files=[make_file("src/foo.ts"), make_file("src/bar.js")])
        pool = enumerate_combo_pool(item, RULES)
        assert len(pool) == 4

        rule_ids_for_ts = {r["rule_id"] for f, r in pool if f["path"] == "src/foo.ts"}
        assert rule_ids_for_ts == {"rule_a", "rule_c"}

        rule_ids_for_js = {r["rule_id"] for f, r in pool if f["path"] == "src/bar.js"}
        assert rule_ids_for_js == {"rule_a", "rule_b"}

    def test_empty_pool_when_no_language_matches(self):
        item = make_gold_item(files=[make_file("src/style.css")])
        pool = enumerate_combo_pool(item, RULES)
        assert pool == []


class TestRenderSeededItem:
    def test_builds_expected_shape(self):
        item = make_gold_item(
            id="owner/repo#9",
            files=[make_file("src/foo.ts", patch="@@ -1,3 +1,3 @@\n a\n b\n c")],
        )
        file_change = item["file_changes"][0]
        rule = RULES[0]

        seeded = render_seeded_item(item, file_change, rule)

        assert seeded["id"] == f"seeded::owner/repo#9::{rule['rule_id']}::src/foo.ts"
        assert seeded["base_source"] == "owner/repo#9"
        assert seeded["must_find"][0]["rule_id"] == rule["rule_id"]
        assert seeded["file_changes"][0]["path"] == "src/foo.ts"
        assert "eval(userInput);" in seeded["file_changes"][0]["patch"]

    def test_includes_deterministic_generation_source(self):
        item = make_gold_item(
            files=[make_file("src/foo.ts", patch="@@ -1,3 +1,3 @@\n a\n b\n c")]
        )
        file_change = item["file_changes"][0]
        seeded = render_seeded_item(item, file_change, RULES[0])
        assert seeded["generation_source"] == "deterministic_fallback"


class TestBuildSeededItemsNoDuplicates:
    def test_no_duplicate_ids_across_many_seeds_full_pool(self):
        item = make_gold_item(files=[make_file("src/foo.ts"), make_file("src/bar.js")])
        for seed in range(50):
            items, _ = build_seeded_items(item, RULES, random.Random(seed), 4)
            ids = [i["id"] for i in items]
            assert len(ids) == len(set(ids))

    def test_no_duplicate_ids_across_many_seeds_partial_pool(self):
        item = make_gold_item(files=[make_file("src/foo.ts"), make_file("src/bar.js")])
        for seed in range(50):
            items, _ = build_seeded_items(item, RULES, random.Random(seed), 3)
            ids = [i["id"] for i in items]
            assert len(items) == 3
            assert len(ids) == len(set(ids))


class TestBuildSeededItemsDeterminism:
    def test_deterministic_for_fixed_seed(self):
        item = make_gold_item(files=[make_file("src/foo.ts"), make_file("src/bar.js")])
        items_a, _ = build_seeded_items(item, RULES, random.Random(42), 2)
        items_b, _ = build_seeded_items(item, RULES, random.Random(42), 2)
        assert [i["id"] for i in items_a] == [i["id"] for i in items_b]


class TestBuildSeededItemsClampAndWarning:
    def test_clamps_and_warns_when_multiplier_exceeds_pool(self):
        item = make_gold_item(id="owner/repo#2", files=[make_file("src/only.ts")])
        single_rule = [RULES[0]]  # matches ts -> pool size 1

        items, warning = build_seeded_items(item, single_rule, random.Random(1), 3)

        assert len(items) == 1
        assert warning is not None
        assert "owner/repo#2" in warning
        assert "multiplier=3" in warning
        assert "combinations=1" in warning

    def test_no_warning_when_pool_exceeds_multiplier(self):
        item = make_gold_item(files=[make_file("src/foo.ts"), make_file("src/bar.js")])
        items, warning = build_seeded_items(item, RULES, random.Random(1), 2)
        assert warning is None
        assert len(items) == 2


class TestBuildSeededItemsSingleFileSingleRuleRegression:
    @pytest.mark.parametrize("multiplier", [1, 2, 5])
    def test_always_yields_exactly_one_item(self, multiplier):
        item = make_gold_item(files=[make_file("src/only.ts")])
        single_rule = [RULES[0]]

        items, warning = build_seeded_items(
            item, single_rule, random.Random(7), multiplier
        )

        assert len(items) == 1
        if multiplier > 1:
            assert warning is not None
        else:
            assert warning is None


class TestBuildSeededItemsEmptyPool:
    def test_returns_no_items_and_no_warning(self):
        item = make_gold_item(files=[make_file("src/style.css")])
        items, warning = build_seeded_items(item, RULES, random.Random(1), 2)
        assert items == []
        assert warning is None


class TestMainCLI:
    def _write_gold(self, tmp_path, items):
        path = tmp_path / "gold.jsonl"
        with open(path, "w", encoding="utf-8") as f:
            for item in items:
                f.write(json.dumps(item) + "\n")
        return path

    def _write_catalog(self, tmp_path, rules):
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps({"rules": rules}))
        return path

    def _stub_generation_model(self, monkeypatch):
        """Configure a generation model without ever calling a real LLM.

        Patches make_llm_mutation_generator to return a stub that always
        returns None (deterministic-fallback path), so these tests --
        which only assert on Phase 1 behavior (dup IDs, clamping, output
        existing) -- stay hermetic and fast.
        """
        monkeypatch.setenv("SEEDED_GEN_MODEL_ID", "gpt-4o-test")
        monkeypatch.setattr(
            build_seeded_set,
            "make_llm_mutation_generator",
            lambda model_id, llm_base_url=None: lambda patch, rule, lang: None,
        )

    def test_no_duplicate_ids_in_output(self, tmp_path, monkeypatch):
        self._stub_generation_model(monkeypatch)
        gold_items = [
            {
                "id": "owner/repo#1",
                "repository": "owner/repo",
                "pr_number": 1,
                "file_changes": [
                    make_file("src/foo.ts"),
                    make_file("src/bar.js"),
                ],
            }
        ]
        gold_path = self._write_gold(tmp_path, gold_items)
        catalog_path = self._write_catalog(tmp_path, RULES)
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
                "--multiplier",
                "3",
                "--seed",
                "42",
            ],
        )

        exit_code = main()

        assert exit_code == 0
        lines = output_path.read_text().strip().splitlines()
        ids = [json.loads(line)["id"] for line in lines]
        assert len(lines) == 3
        assert len(ids) == len(set(ids))

    def test_warns_on_stderr_when_multiplier_exceeds_pool(
        self, tmp_path, monkeypatch, capsys
    ):
        self._stub_generation_model(monkeypatch)
        gold_items = [
            {
                "id": "owner/repo#2",
                "repository": "owner/repo",
                "pr_number": 2,
                "file_changes": [make_file("src/only.ts")],
            }
        ]
        gold_path = self._write_gold(tmp_path, gold_items)
        catalog_path = self._write_catalog(tmp_path, [RULES[0]])
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
                "--multiplier",
                "3",
            ],
        )

        exit_code = main()

        assert exit_code == 0
        captured = capsys.readouterr()
        assert "[SEEDED-WARN]" in captured.err
        assert "[SEEDED-WARN]" not in captured.out

    def test_exits_with_error_and_message_when_catalog_invalid(
        self, tmp_path, monkeypatch, capsys
    ):
        gold_items = [
            {
                "id": "owner/repo#1",
                "repository": "owner/repo",
                "pr_number": 1,
                "file_changes": [make_file("src/foo.ts")],
            }
        ]
        gold_path = self._write_gold(tmp_path, gold_items)
        invalid_rule = {
            "rule_id": "rule_missing_snippets",
            "languages": ["ts"],
            "runtime": "universal",
            "category": "security",
            "severity": "high",
            "summary": "Missing language_snippets",
            "line_snippet": "eval(x);",
        }
        catalog_path = self._write_catalog(tmp_path, [invalid_rule])
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
            ],
        )

        exit_code = main()

        assert exit_code == 1
        captured = capsys.readouterr()
        assert "[SEEDED-ERROR]" in captured.err
        assert not output_path.exists()

    def test_exits_with_error_when_catalog_rules_not_a_list(
        self, tmp_path, monkeypatch, capsys
    ):
        gold_items = [
            {
                "id": "owner/repo#1",
                "repository": "owner/repo",
                "pr_number": 1,
                "file_changes": [make_file("src/foo.ts")],
            }
        ]
        gold_path = self._write_gold(tmp_path, gold_items)
        catalog_path = tmp_path / "catalog.json"
        catalog_path.write_text(json.dumps({"rules": None}))
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
            ],
        )

        exit_code = main()

        assert exit_code == 1
        captured = capsys.readouterr()
        assert "[SEEDED-ERROR]" in captured.err
        assert not output_path.exists()

    def test_exits_with_error_when_catalog_root_not_a_dict(
        self, tmp_path, monkeypatch, capsys
    ):
        gold_items = [
            {
                "id": "owner/repo#1",
                "repository": "owner/repo",
                "pr_number": 1,
                "file_changes": [make_file("src/foo.ts")],
            }
        ]
        gold_path = self._write_gold(tmp_path, gold_items)
        catalog_path = tmp_path / "catalog.json"
        catalog_path.write_text(json.dumps(["not", "a", "dict"]))
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
            ],
        )

        exit_code = main()

        assert exit_code == 1
        captured = capsys.readouterr()
        assert "[SEEDED-ERROR]" in captured.err
        assert not output_path.exists()

    def test_output_with_no_directory_component_does_not_crash(
        self, tmp_path, monkeypatch
    ):
        self._stub_generation_model(monkeypatch)
        gold_items = [
            {
                "id": "owner/repo#1",
                "repository": "owner/repo",
                "pr_number": 1,
                "file_changes": [make_file("src/foo.ts")],
            }
        ]
        gold_path = self._write_gold(tmp_path, gold_items)
        catalog_path = self._write_catalog(tmp_path, RULES)
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                "seeded.jsonl",
            ],
        )

        exit_code = main()

        assert exit_code == 0
        assert (tmp_path / "seeded.jsonl").exists()


class TestSplitHunks:
    def test_splits_two_hunks_into_separate_lists(self):
        patch = (
            "@@ -1,4 +1,5 @@\n"
            " import a\n"
            " import b\n"
            "+import c\n"
            " import d\n"
            "\n"
            "@@ -10,6 +11,11 @@ export class Foo {\n"
            "   constructor() {}\n"
            "+  bar() {\n"
            "+    return 1;\n"
            "+  }\n"
        )
        hunks = split_hunks(patch)
        assert len(hunks) == 2
        assert hunks[0][0].startswith("@@ -1,4 +1,5 @@")
        assert hunks[1][0].startswith("@@ -10,6 +11,11 @@")
        assert hunks[0][1:] == [
            " import a",
            " import b",
            "+import c",
            " import d",
            "",
        ]

    def test_single_hunk_patch_returns_one_element_list(self):
        patch = "@@ -1,2 +1,2 @@\n line1\n line2"
        hunks = split_hunks(patch)
        assert len(hunks) == 1
        assert hunks[0][0].startswith("@@ -1,2 +1,2 @@")

    def test_no_hunk_header_returns_empty_list(self):
        patch = " just some context\n more context"
        assert split_hunks(patch) == []


class TestSelectTargetHunk:
    def test_picks_hunk_with_most_added_lines(self):
        hunks = [
            ["@@ -1,4 +1,5 @@", "+import c", " import d"],
            ["@@ -10,6 +11,11 @@", "+bar() {", "+  return 1;", "+}"],
        ]
        assert select_target_hunk(hunks) == 1

    def test_tie_breaks_to_earliest_hunk(self):
        hunks = [
            ["@@ -1,2 +1,2 @@", "+a"],
            ["@@ -5,2 +5,2 @@", "+b"],
        ]
        assert select_target_hunk(hunks) == 0

    def test_single_hunk_returns_index_zero(self):
        hunks = [["@@ -1,2 +1,2 @@", "+a"]]
        assert select_target_hunk(hunks) == 0


class TestParseHunkNewStart:
    def test_parses_new_start_from_header(self):
        assert parse_hunk_new_start("@@ -10,6 +11,11 @@") == 11

    def test_parses_header_with_trailing_context_text(self):
        assert parse_hunk_new_start("@@ -10,6 +11,11 @@ export class Foo {") == 11

    def test_malformed_header_falls_back_to_one(self):
        assert parse_hunk_new_start("not a hunk header") == 1


class TestCountNewLinesBefore:
    def test_counts_context_and_added_lines(self):
        hunk = [
            "@@ -10,6 +11,11 @@",
            "   constructor() {}",
            "+  bar() {",
            "+    return 1;",
            "+  }",
        ]
        # insertion_idx=4 -> count lines at indices 1..4 (context+added)
        assert count_new_lines_before(hunk, 4) == 4

    def test_excludes_removed_lines(self):
        hunk = [
            "@@ -10,6 +11,11 @@",
            "-  removedLine();",
            "   constructor() {}",
            "+  bar() {",
        ]
        assert count_new_lines_before(hunk, 3) == 2

    def test_zero_when_insertion_idx_is_header(self):
        hunk = ["@@ -10,6 +11,11 @@", "   constructor() {}"]
        assert count_new_lines_before(hunk, 0) == 0


class TestFindInsertionPoint:
    def test_inserts_after_last_statement_terminated_added_line(self):
        hunk = [
            "@@ -10,6 +11,11 @@",
            "   constructor() {}",
            "+  const doc = await this.service.findById(id);",
            "+  if (!doc) {",
            "+    throw new NotFoundException('Document not found');",
            "+  }",
            "+  return doc;",
            "   }",
        ]
        # last non-`}` terminator-matching added line is index 6
        # ("+  return doc;"); the added "+  }" at index 5 closes the `if`
        # block and is deliberately not treated as a terminator, since
        # inserting after a closing brace risks exiting the enclosing scope.
        assert find_insertion_point(hunk) == 6

    def test_skips_import_like_added_lines(self):
        hunk = [
            "@@ -1,4 +1,6 @@",
            " import a from 'a';",
            "+import c from 'c';",
            " import d from 'd';",
            "+const config = loadConfig();",
        ]
        # the import-like added line is skipped in favor of the later
        # non-import statement
        assert find_insertion_point(hunk) == 4

    def test_falls_back_to_last_added_line_when_no_terminator_matches(self):
        hunk = [
            "@@ -1,3 +1,4 @@",
            " const x = (",
            "+  a,",
            "+  b",
            " )",
        ]
        assert find_insertion_point(hunk) == 3

    def test_falls_back_to_header_when_no_added_lines(self):
        hunk = ["@@ -1,2 +1,2 @@", " line1", " line2"]
        assert find_insertion_point(hunk) == 0

    def test_import_only_hunk_falls_back_to_import_line(self):
        # Known Phase 1 limitation: when every added line looks import-like,
        # there is no non-import candidate to prefer, so find_insertion_point
        # falls back to the last added line overall (the import itself).
        # This does not fully solve R1/R3 for import-only hunks, matching
        # docs/eval-seeded-mutation-injection-design.md 3.1.3's acknowledged
        # limitation.
        hunk = [
            "@@ -1,3 +1,4 @@",
            " import a from 'a';",
            "+import b from 'b';",
            " import c from 'c';",
        ]
        assert find_insertion_point(hunk) == 2


def _published_docs_resolver_patch():
    """Two-hunk sample modeled on hoppscotch#6171 published-docs.resolver.ts.

    Hunk 1 (imports) has 1 added line; hunk 2 (resolver body) has 5. This
    reproduces the exact scenario that motivated
    docs/eval-seeded-mutation-injection-design.md: a mutation must land in
    the body hunk, not interleaved among the imports.
    """
    lines = [
        "@@ -1,4 +1,5 @@",
        " import { Injectable } from '@nestjs/common';",
        " import { Resolver, Query, Args } from '@nestjs/graphql';",
        "+import { PublishedDocsService } from './published-docs.service';",
        " import { Logger } from '@nestjs/common';",
        " ",
        "@@ -10,6 +11,11 @@ export class PublishedDocsResolver {",
        "   constructor(private readonly service: PublishedDocsService) {}",
        " ",
        "   @Query(() => PublishedDoc)",
        "   async publishedDoc(@Args('id') id: string): Promise<PublishedDoc> {",
        "+    const doc = await this.service.findById(id);",
        "+    if (!doc) {",
        "+      throw new NotFoundException('Document not found');",
        "+    }",
        "+    return doc;",
        "   }",
        " }",
    ]
    return "\n".join(lines)


class TestInjectPatchDirect:
    def test_single_hunk_no_added_lines_matches_legacy_placement(self):
        patch = "@@ -1,2 +1,2 @@\n line1\n line2"
        result, line = inject_patch(patch, "eval(x);")
        assert line == 1
        assert result.splitlines() == [
            "@@ -1,2 +1,2 @@",
            "+eval(x);",
            " line1",
            " line2",
        ]

    def test_multi_hunk_selects_densest_hunk_and_computes_line(self):
        patch = _published_docs_resolver_patch()
        result, line = inject_patch(patch, "eval(userInput);")
        assert line == 20

        hunks_out = split_hunks(result)
        assert len(hunks_out) == 2
        return_doc_idx = hunks_out[1].index("+    return doc;")
        assert hunks_out[1][return_doc_idx + 1] == "+eval(userInput);"

    def test_import_hunk_is_not_selected_when_body_hunk_has_more_additions(self):
        patch = _published_docs_resolver_patch()
        original_hunk1 = split_hunks(patch)[0]

        result, _ = inject_patch(patch, "eval(userInput);")

        hunks_out = split_hunks(result)
        assert hunks_out[0] == original_hunk1

    def test_context_lines_are_prefixed_and_offset_line_number(self):
        patch = "@@ -1,2 +1,2 @@\n line1\n line2"
        result, line = inject_patch(patch, "eval(x);", context_lines=["const x = 1;"])
        assert line == 2
        assert result.splitlines() == [
            "@@ -1,2 +1,2 @@",
            "+const x = 1;",
            "+eval(x);",
            " line1",
            " line2",
        ]

    def test_no_hunk_header_falls_back_to_legacy_top_insertion(self):
        patch = " just context\n more context"
        result, line = inject_patch(patch, "eval(x);")
        assert line == 1
        lines = result.splitlines()
        assert lines[0] == "+eval(x);"
        assert lines[1:] == [" just context", " more context"]

    def test_empty_patch_returns_line_one(self):
        result, line = inject_patch("", "eval(x);")
        assert result == ""
        assert line == 1

    def test_malformed_header_fallback_still_extracts_line_number(self):
        # Starts with "@@" (so the top-of-patch insert_idx=1 branch fires)
        # but doesn't match the strict hunk header pattern, so split_hunks()
        # returns [] and the legacy fallback in inject_patch() is used. The
        # fallback should still best-effort extract a line number from the
        # malformed header instead of hardcoding 1.
        patch = "@@ malformed +42 change @@\n line1\n line2"
        result, line = inject_patch(patch, "eval(x);")
        assert line == 42
        assert result.splitlines() == [
            "@@ malformed +42 change @@",
            "+eval(x);",
            " line1",
            " line2",
        ]


class TestGetSnippetForLang:
    def test_returns_language_specific_snippet_when_present(self):
        rule = {
            "line_snippet": "eval(x);",
            "language_snippets": {"ts": "const y: unknown = eval(x);"},
        }
        assert get_snippet_for_lang(rule, "ts") == "const y: unknown = eval(x);"

    def test_falls_back_to_line_snippet_when_language_missing(self):
        rule = {"line_snippet": "eval(x);", "language_snippets": {"ts": "..."}}
        assert get_snippet_for_lang(rule, "vue") == "eval(x);"


def _valid_rule(**overrides):
    rule = {
        "rule_id": "rule_x",
        "languages": ["js", "ts"],
        "runtime": "universal",
        "required_tokens": [r"\bdoSomething\("],
        "line_snippet": "doSomething(x);",
        "language_snippets": {
            "js": "doSomething(x);",
            "ts": "doSomething(x);",
        },
    }
    rule.update(overrides)
    return rule


class TestValidateCatalog:
    def test_valid_catalog_returns_no_errors(self):
        assert validate_catalog([_valid_rule()]) == []

    def test_missing_language_snippet_for_declared_language_is_reported(self):
        rule = _valid_rule(languages=["js", "ts", "vue"])
        errors = validate_catalog([rule])
        assert len(errors) == 1
        assert "rule_x" in errors[0]
        assert "vue" in errors[0]

    def test_missing_runtime_is_reported(self):
        rule = _valid_rule()
        del rule["runtime"]
        errors = validate_catalog([rule])
        assert any("runtime" in e for e in errors)

    def test_invalid_runtime_value_is_reported(self):
        rule = _valid_rule(runtime="server")
        errors = validate_catalog([rule])
        assert any("runtime" in e for e in errors)

    def test_forbidden_browser_global_in_snippet_is_reported(self):
        rule = _valid_rule(
            language_snippets={
                "js": "window.location.href = x;",
                "ts": "doSomething(x);",
            }
        )
        errors = validate_catalog([rule])
        assert any("window." in e for e in errors)

    def test_forbidden_browser_global_in_context_lines(self):
        rule = _valid_rule(context_lines=["const x = document.title;"])
        errors = validate_catalog([rule])
        assert any("document." in e for e in errors)

    def test_collects_multiple_errors_across_rules(self):
        bad_rule_a = _valid_rule(rule_id="rule_a")
        del bad_rule_a["runtime"]
        bad_rule_b = _valid_rule(rule_id="rule_b", languages=["js", "vue"])
        errors = validate_catalog([bad_rule_a, bad_rule_b])
        assert len(errors) == 2

    def test_real_catalog_file_passes_validation(self):
        catalog_path = (
            Path(__file__).parents[3]
            / "evaluation"
            / "config"
            / "seeded_mutations.json"
        )
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        assert validate_catalog(catalog["rules"]) == []

    def test_languages_not_a_list_is_reported_without_crash(self):
        rule = _valid_rule(languages="ts")
        errors = validate_catalog([rule])
        assert any("languages" in e and "rule_x" in e for e in errors)

    def test_language_snippets_not_a_dict_is_reported_without_crash(self):
        rule = _valid_rule(language_snippets=None)
        errors = validate_catalog([rule])
        assert any("language_snippets" in e and "rule_x" in e for e in errors)

    def test_non_string_snippet_value_is_reported_without_crash(self):
        rule = _valid_rule(language_snippets={"js": "doSomething(x);", "ts": 12345})
        errors = validate_catalog([rule])
        assert any("rule_x" in e for e in errors)

    def test_unhashable_language_entry_is_reported_without_crash(self):
        rule = _valid_rule(languages=["js", ["ts"]])
        errors = validate_catalog([rule])
        assert any("rule_x" in e for e in errors)

    def test_non_dict_rule_entry_is_reported_without_crash(self):
        errors = validate_catalog([None, "not a rule", _valid_rule()])
        assert len(errors) == 2
        assert all("must be an object" in e for e in errors)

    def test_missing_line_snippet_is_reported(self):
        rule = _valid_rule()
        del rule["line_snippet"]
        errors = validate_catalog([rule])
        assert any("line_snippet" in e for e in errors)

    def test_non_string_line_snippet_is_reported_without_crash(self):
        rule = _valid_rule(line_snippet=12345)
        errors = validate_catalog([rule])
        assert any("line_snippet" in e for e in errors)


class TestValidateCatalogRequiredTokens:
    def test_valid_required_tokens_returns_no_errors(self):
        assert validate_catalog([_valid_rule()]) == []

    def test_missing_required_tokens_is_reported(self):
        rule = _valid_rule()
        del rule["required_tokens"]
        errors = validate_catalog([rule])
        assert any("required_tokens" in e and "rule_x" in e for e in errors)

    def test_required_tokens_not_a_list_is_reported_without_crash(self):
        rule = _valid_rule(required_tokens=r"\bdoSomething\(")
        errors = validate_catalog([rule])
        assert any("required_tokens" in e and "rule_x" in e for e in errors)

    def test_required_tokens_empty_list_is_reported(self):
        rule = _valid_rule(required_tokens=[])
        errors = validate_catalog([rule])
        assert any("required_tokens" in e and "rule_x" in e for e in errors)

    def test_required_tokens_non_string_element_is_reported_without_crash(self):
        rule = _valid_rule(required_tokens=[123])
        errors = validate_catalog([rule])
        assert any("required_tokens" in e and "rule_x" in e for e in errors)

    def test_required_tokens_invalid_regex_is_reported_without_crash(self):
        rule = _valid_rule(required_tokens=["("])
        errors = validate_catalog([rule])
        assert any("required_tokens" in e and "rule_x" in e for e in errors)

    def test_line_snippet_not_satisfying_required_tokens_is_reported(self):
        rule = _valid_rule(line_snippet="somethingElse(x);")
        errors = validate_catalog([rule])
        assert any(
            "required_tokens" in e and "line_snippet" in e and "rule_x" in e
            for e in errors
        )

    def test_language_snippet_not_satisfying_required_tokens_is_reported(self):
        rule = _valid_rule(
            language_snippets={
                "js": "doSomething(x);",
                "ts": "somethingElse(x);",
            }
        )
        errors = validate_catalog([rule])
        assert any(
            "required_tokens" in e and "ts" in e and "rule_x" in e for e in errors
        )

    def test_multiple_required_tokens_are_all_required_for_self_consistency(self):
        rule = _valid_rule(
            required_tokens=[r"\bdoSomething\(", r"\bawait\b"],
            line_snippet="doSomething(x);",
            language_snippets={
                "js": "doSomething(x);",
                "ts": "doSomething(x);",
            },
        )
        errors = validate_catalog([rule])
        assert any("required_tokens" in e and "rule_x" in e for e in errors)


class TestValidateCatalogSelfContainment:
    """Issue #131 design doc §7.3/7.4.3: a snippet whose `required_tokens`
    requires `await` implicitly requires the enclosing function to be
    `async`, but injection is pure addition (no signature rewrite allowed).
    Catalog validation must catch this at build time rather than let it
    surface later as a high deterministic_fallback rate."""

    def test_await_required_token_without_async_snippet_is_reported(self):
        rule = _valid_rule(
            required_tokens=[r"\bawait\b"],
            line_snippet="await api.get('/items/' + id);",
            language_snippets={
                "js": "await api.get('/items/' + id);",
                "ts": "await api.get('/items/' + id);",
            },
        )
        errors = validate_catalog([rule])
        assert any(
            "self-containment" in e and "rule_x" in e and "js" in e for e in errors
        )
        assert any(
            "self-containment" in e and "rule_x" in e and "ts" in e for e in errors
        )

    def test_await_required_token_with_async_iife_snippet_is_allowed(self):
        rule = _valid_rule(
            required_tokens=[r"\bawait\b"],
            line_snippet="(async () => { await api.get('/x'); })();",
            language_snippets={
                "js": "(async () => { await api.get('/x'); })();",
                "ts": "(async () => { await api.get('/x'); })();",
            },
        )
        assert validate_catalog([rule]) == []

    def test_no_await_requirement_is_unaffected(self):
        assert validate_catalog([_valid_rule()]) == []

    def test_real_catalog_rules_satisfy_self_containment(self):
        catalog_path = (
            Path(__file__).parents[3]
            / "evaluation"
            / "config"
            / "seeded_mutations.json"
        )
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        errors = validate_catalog(catalog["rules"])
        assert not any("self-containment" in e for e in errors)


# Shared fixtures for V1-V4 + recompute_injected_line tests below: a single
# hunk original patch with one pre-existing context line and one
# pre-existing "+" line (representing the real PR's own change), plus a
# "good" mutation that appends one more injected "+" line after it.
_ORIGINAL_SINGLE_HUNK = "@@ -1,2 +1,2 @@\n context1\n+addedByPr"
_MUTATED_SINGLE_HUNK_GOOD = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+eval(userInput);"


class TestVerifyDiffParses:
    def test_well_formed_patch_passes(self):
        assert verify_diff_parses(_MUTATED_SINGLE_HUNK_GOOD) is True

    def test_empty_patch_fails(self):
        assert verify_diff_parses("") is False

    def test_patch_without_hunk_header_fails(self):
        assert verify_diff_parses("just some text\nno header here") is False

    def test_line_with_invalid_marker_fails(self):
        patch = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\neval(userInput);"
        assert verify_diff_parses(patch) is False

    def test_git_diff_preamble_before_first_hunk_header_fails(self):
        # split_hunks() silently discards anything before the first "@@"
        # header, so a naive check that only looks at hunk[1:] would let
        # this preamble slide through unvalidated -- and it would still
        # end up written into the seeded_set.jsonl patch field.
        patch = (
            "diff --git a/src/foo.ts b/src/foo.ts\n"
            "index abc123..def456 100644\n"
            "--- a/src/foo.ts\n"
            "+++ b/src/foo.ts\n"
            "@@ -1,2 +1,3 @@\n"
            " context1\n"
            "+addedByPr\n"
            "+eval(userInput);"
        )
        assert verify_diff_parses(patch) is False

    def test_blank_preamble_lines_before_first_hunk_header_are_tolerated(self):
        patch = "\n\n@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+eval(userInput);"
        assert verify_diff_parses(patch) is True

    def test_marker_less_blank_line_inside_hunk_body_fails(self):
        # A genuinely blank source line must be represented as " " (a
        # context marker followed by nothing), not a bare empty string
        # with no marker at all -- the latter is not valid unified diff
        # syntax even though it's easy to produce by accident when
        # joining lines with "\n\n" between hunks.
        patch = "@@ -1,3 +1,4 @@\n context1\n\n+addedByPr\n+eval(userInput);"
        assert verify_diff_parses(patch) is False

    def test_no_newline_at_end_of_file_marker_is_tolerated(self):
        # `\ No newline at end of file` is a standard unified-diff marker
        # git emits when the referenced line lacks a trailing newline; it
        # is neither a preamble line nor a context/added/removed line, and
        # must not be rejected as an "invalid marker".
        patch = (
            "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n"
            "+eval(userInput);\n\\ No newline at end of file"
        )
        assert verify_diff_parses(patch) is True


class TestVerifyOnlyAdditionsChanged:
    def test_appended_line_passes(self):
        assert (
            verify_only_additions_changed(
                _ORIGINAL_SINGLE_HUNK, _MUTATED_SINGLE_HUNK_GOOD
            )
            is True
        )

    def test_identical_patch_fails(self):
        assert (
            verify_only_additions_changed(_ORIGINAL_SINGLE_HUNK, _ORIGINAL_SINGLE_HUNK)
            is False
        )

    def test_modified_context_line_fails(self):
        mutated = "@@ -1,2 +1,3 @@\n context1_CHANGED\n+addedByPr\n+eval(userInput);"
        assert verify_only_additions_changed(_ORIGINAL_SINGLE_HUNK, mutated) is False

    def test_modified_original_added_line_fails(self):
        mutated = "@@ -1,2 +1,3 @@\n context1\n+addedByPr_CHANGED\n+eval(userInput);"
        assert verify_only_additions_changed(_ORIGINAL_SINGLE_HUNK, mutated) is False

    def test_dropped_original_line_fails(self):
        mutated = "@@ -1,2 +1,2 @@\n context1\n+eval(userInput);"
        assert verify_only_additions_changed(_ORIGINAL_SINGLE_HUNK, mutated) is False

    def test_hunk_count_mismatch_fails(self):
        mutated = (
            "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+eval(userInput);\n"
            "@@ -10,1 +11,2 @@\n context10\n+extraHunk"
        )
        assert verify_only_additions_changed(_ORIGINAL_SINGLE_HUNK, mutated) is False


class TestVerifyOnlyAdditionsChangedWhitespaceTolerance:
    """Issue #131 (1/7 false-negative case, bitwarden index.d.ts): a
    pre-existing line reproduced by the LLM with only indentation/trailing-
    semicolon differences was rejected by the previous exact-match
    comparison. Whitespace/semicolon normalization must accept this while
    still rejecting genuine content changes (structural rewrites)."""

    _ORIGINAL = (
        "@@ -1,2 +1,2 @@\n context1\n+export function isolateProcess(): Promise<void>;"
    )

    def test_reindented_preexisting_line_passes(self):
        mutated = (
            "@@ -1,2 +1,3 @@\n"
            " context1\n"
            "+  export function isolateProcess(): Promise<void>\n"
            "+eval(userInput);"
        )
        assert verify_only_additions_changed(self._ORIGINAL, mutated) is True

    def test_context_line_with_different_indentation_passes(self):
        original = "@@ -1,2 +1,2 @@\n     context1\n+addedByPr"
        mutated = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+eval(userInput);"
        assert verify_only_additions_changed(original, mutated) is True

    def test_structural_rewrite_still_fails_despite_whitespace_tolerance(self):
        # Content itself differs (expression body -> block body), not just
        # whitespace/semicolons -- normalization must not paper over this.
        original = (
            "@@ -1,2 +1,2 @@\n"
            " context1\n"
            "+const openLink = (_e, url: string) => shell.openExternal(url);"
        )
        mutated = (
            "@@ -1,2 +1,5 @@\n"
            " context1\n"
            "+const openLink = async (_e, url: string) => {\n"
            "+  await fetch('/api/items/' + params.id);\n"
            "+  shell.openExternal(url);\n"
            "+};"
        )
        assert verify_only_additions_changed(original, mutated) is False

    def test_dropped_original_line_still_fails_despite_whitespace_tolerance(self):
        mutated = "@@ -1,2 +1,2 @@\n context1\n+eval(userInput);"
        assert verify_only_additions_changed(self._ORIGINAL, mutated) is False


class TestVerifyRequiredTokens:
    def test_single_required_token_present_passes(self):
        assert (
            verify_required_tokens(
                _ORIGINAL_SINGLE_HUNK, _MUTATED_SINGLE_HUNK_GOOD, [r"\beval\("]
            )
            is True
        )

    def test_single_required_token_absent_fails(self):
        assert (
            verify_required_tokens(
                _ORIGINAL_SINGLE_HUNK, _MUTATED_SINGLE_HUNK_GOOD, [r"\binnerHTML\b"]
            )
            is False
        )

    def test_and_semantics_all_tokens_required(self):
        original = "@@ -1,2 +1,2 @@\n context1\n+addedByPr"
        mutated = (
            "@@ -1,2 +1,4 @@\n context1\n+addedByPr\n"
            "+for (const id of ids) {\n+  await api.get('/items/' + id);\n+}"
        )
        assert (
            verify_required_tokens(original, mutated, [r"\bfor\s*\(", r"\bawait\b"])
            is True
        )

    def test_and_semantics_missing_one_token_fails(self):
        original = "@@ -1,2 +1,2 @@\n context1\n+addedByPr"
        mutated = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+for (const id of ids) {}"
        assert (
            verify_required_tokens(original, mutated, [r"\bfor\s*\(", r"\bawait\b"])
            is False
        )

    def test_tokens_may_span_multiple_added_lines(self):
        original = "@@ -1,2 +1,2 @@\n context1\n+addedByPr"
        mutated = (
            "@@ -1,2 +1,4 @@\n context1\n+addedByPr\n"
            "+for (const id of ids) {\n+  await api.get('/items/' + id); }"
        )
        assert (
            verify_required_tokens(original, mutated, [r"\bfor\s*\(", r"\bawait\b"])
            is True
        )

    def test_word_boundary_avoids_false_positive_substring_match(self):
        original = "@@ -1,2 +1,2 @@\n context1\n+addedByPr"
        mutated = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+retrieval(userInput);"
        assert verify_required_tokens(original, mutated, [r"\beval\("]) is False

    def test_empty_required_tokens_fails(self):
        assert (
            verify_required_tokens(_ORIGINAL_SINGLE_HUNK, _MUTATED_SINGLE_HUNK_GOOD, [])
            is False
        )

    def test_token_already_present_in_original_patch_does_not_leak_into_match(self):
        # The original PR's own (pre-existing) "+" line already contains
        # "eval(" -- unrelated to the injected mutation. V3 must not
        # treat that as satisfying the required token; only newly
        # inserted "+" lines should count, otherwise a broken/no-op
        # injection could still pass and corrupt the dataset (real
        # review finding on PR #122).
        original = "@@ -1,2 +1,2 @@\n context1\n+eval(existingCall);"
        mutated = "@@ -1,2 +1,3 @@\n context1\n+eval(existingCall);\n+somethingElse();"
        assert verify_required_tokens(original, mutated, [r"\beval\("]) is False

    def test_hunk_count_mismatch_fails(self):
        original = "@@ -1,2 +1,2 @@\n context1\n+addedByPr"
        mutated = (
            "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+eval(userInput);\n"
            "@@ -10,1 +11,2 @@\n context10\n+extraHunk"
        )
        assert verify_required_tokens(original, mutated, [r"\beval\("]) is False

    def test_modified_existing_line_fails(self):
        original = "@@ -1,2 +1,2 @@\n context1\n+addedByPr"
        mutated = "@@ -1,2 +1,3 @@\n context1_CHANGED\n+addedByPr\n+eval(userInput);"
        assert verify_required_tokens(original, mutated, [r"\beval\("]) is False


class TestVerifyRuntimeConsistency:
    def test_node_runtime_with_window_global_fails(self):
        mutated = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+window.location.href = x;"
        assert verify_runtime_consistency(mutated, "node") is False

    def test_node_runtime_without_forbidden_global_passes(self):
        assert verify_runtime_consistency(_MUTATED_SINGLE_HUNK_GOOD, "node") is True

    def test_browser_runtime_with_window_global_still_passes_noop(self):
        mutated = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+window.location.href = x;"
        assert verify_runtime_consistency(mutated, "browser") is True

    def test_universal_runtime_with_window_global_still_passes_noop(self):
        mutated = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+window.location.href = x;"
        assert verify_runtime_consistency(mutated, "universal") is True


class TestRecomputeInjectedLine:
    def test_recomputes_line_ignoring_llm_self_report(self):
        line = recompute_injected_line(_ORIGINAL_SINGLE_HUNK, _MUTATED_SINGLE_HUNK_GOOD)
        assert line == 3

    def test_no_new_lines_returns_none(self):
        assert (
            recompute_injected_line(_ORIGINAL_SINGLE_HUNK, _ORIGINAL_SINGLE_HUNK)
            is None
        )

    def test_non_contiguous_new_lines_in_same_hunk_returns_none(self):
        original = "@@ -1,3 +1,3 @@\n context1\n+addedByPr\n context2"
        mutated = (
            "@@ -1,3 +1,5 @@\n context1\n+injectedBefore\n+addedByPr\n"
            " context2\n+injectedAfter"
        )
        assert recompute_injected_line(original, mutated) is None

    def test_two_hunks_both_changed_returns_none(self):
        original = (
            "@@ -1,2 +1,2 @@\n context1\n+addedByPr\n@@ -10,1 +11,1 @@\n context10"
        )
        mutated = (
            "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+eval(userInput);\n"
            "@@ -10,1 +11,2 @@\n context10\n+extraInjected"
        )
        assert recompute_injected_line(original, mutated) is None

    def test_injected_block_after_multiple_context_lines(self):
        original = "@@ -5,2 +5,2 @@\n context5\n context6"
        mutated = "@@ -5,2 +5,3 @@\n context5\n context6\n+eval(userInput);"
        assert recompute_injected_line(original, mutated) == 7

    def test_hunk_count_mismatch_returns_none(self):
        mutated = (
            "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+eval(userInput);\n"
            "@@ -10,1 +11,2 @@\n context10\n+extraHunk"
        )
        assert recompute_injected_line(_ORIGINAL_SINGLE_HUNK, mutated) is None

    def test_modified_existing_line_returns_none(self):
        mutated = "@@ -1,2 +1,3 @@\n context1_CHANGED\n+addedByPr\n+eval(userInput);"
        assert recompute_injected_line(_ORIGINAL_SINGLE_HUNK, mutated) is None


class TestMutatedPatchOutputSchema:
    def test_valid_construction_succeeds(self):
        output = MutatedPatchOutput(
            mutated_patch=_MUTATED_SINGLE_HUNK_GOOD,
            injected_line=3,
            reachability_rationale="Reached via the module-level init path.",
        )
        assert output.mutated_patch == _MUTATED_SINGLE_HUNK_GOOD
        assert output.injected_line == 3

    def test_blank_reachability_rationale_is_rejected(self):
        with pytest.raises(ValidationError):
            MutatedPatchOutput(
                mutated_patch=_MUTATED_SINGLE_HUNK_GOOD,
                injected_line=3,
                reachability_rationale="",
            )

    def test_whitespace_only_reachability_rationale_is_rejected(self):
        with pytest.raises(ValidationError):
            MutatedPatchOutput(
                mutated_patch=_MUTATED_SINGLE_HUNK_GOOD,
                injected_line=3,
                reachability_rationale="   \n\t",
            )


class TestBuildGenerationPrompt:
    def test_includes_target_runtime(self):
        # The system prompt tells the model to use APIs valid for the
        # "target language and runtime given below" -- if runtime is
        # never actually included here, the model has no way to honor
        # that constraint (real review finding on PR #122).
        prompt = build_generation_prompt(_ORIGINAL_SINGLE_HUNK, RULES[0], "ts")
        assert "universal" in prompt
        assert "runtime" in prompt.lower()

    def test_includes_target_language(self):
        prompt = build_generation_prompt(_ORIGINAL_SINGLE_HUNK, RULES[0], "ts")
        assert "ts" in prompt


class TestMakeLlmMutationGenerator:
    """Exercises the `Model.structured_output()` call path.

    Not the Agent-level `structured_output_model` tool-calling path: that
    path proved unreliable against self-hosted OpenAI-compatible models
    (strands-agents/harness-sdk#3336) and was dropped in favor of calling
    `Model.structured_output()` directly. See `make_llm_mutation_generator`.
    """

    def test_calls_model_structured_output_and_returns_parsed_output(self):
        expected = MutatedPatchOutput(
            mutated_patch=_MUTATED_SINGLE_HUNK_GOOD,
            injected_line=3,
            reachability_rationale="Reached via the existing init flow.",
        )
        call_count = 0

        async def fake_structured_output(
            output_model, messages, system_prompt=None, **kwargs
        ):
            nonlocal call_count
            call_count += 1
            assert output_model is MutatedPatchOutput
            yield {"output": expected}

        mock_model = MagicMock()
        mock_model.structured_output = fake_structured_output
        with patch.object(build_seeded_set, "OpenAIModel", return_value=mock_model):
            generate = make_llm_mutation_generator("gpt-4o")
            result = generate(_ORIGINAL_SINGLE_HUNK, RULES[0], "ts")

        assert result is expected
        assert call_count == 1

    def test_returns_none_when_structured_output_yields_nothing(self):
        async def empty_structured_output(
            output_model, messages, system_prompt=None, **kwargs
        ):
            return
            yield  # pragma: no cover - makes this an async generator

        mock_model = MagicMock()
        mock_model.structured_output = empty_structured_output
        with patch.object(build_seeded_set, "OpenAIModel", return_value=mock_model):
            generate = make_llm_mutation_generator("gpt-4o")
            result = generate(_ORIGINAL_SINGLE_HUNK, RULES[0], "ts")

        assert result is None

    def test_returns_none_and_does_not_raise_when_call_fails(self):
        call_count = 0

        async def failing_structured_output(
            output_model, messages, system_prompt=None, **kwargs
        ):
            nonlocal call_count
            call_count += 1
            raise RuntimeError("boom")
            yield  # pragma: no cover - makes this an async generator

        mock_model = MagicMock()
        mock_model.structured_output = failing_structured_output
        with patch.object(build_seeded_set, "OpenAIModel", return_value=mock_model):
            generate = make_llm_mutation_generator("gpt-4o")
            result = generate(_ORIGINAL_SINGLE_HUNK, RULES[0], "ts")

        assert result is None
        assert call_count == 1  # no retry on failure

    def test_uses_base_url_client_args_when_provided(self):
        with patch.object(build_seeded_set, "OpenAIModel") as mock_model_cls:
            make_llm_mutation_generator("gpt-4o", "https://openrouter.example/api/v1")

        _, kwargs = mock_model_cls.call_args
        assert kwargs["client_args"] == {
            "base_url": "https://openrouter.example/api/v1"
        }


class TestPassesPostGenerationChecks:
    def test_good_output_passes_all_checks(self):
        assert (
            passes_post_generation_checks(
                _ORIGINAL_SINGLE_HUNK, _MUTATED_SINGLE_HUNK_GOOD, RULES[0]
            )
            is True
        )

    def test_missing_required_token_fails(self):
        mutated = "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+somethingElse();"
        assert (
            passes_post_generation_checks(_ORIGINAL_SINGLE_HUNK, mutated, RULES[0])
            is False
        )


class TestRenderSeededItemWithGeneration:
    def _gold_item_and_file(self):
        item = make_gold_item(
            id="owner/repo#9",
            files=[make_file("src/foo.ts", patch=_ORIGINAL_SINGLE_HUNK)],
        )
        return item, item["file_changes"][0]

    def test_generate_fn_none_uses_phase1_path(self):
        item, file_change = self._gold_item_and_file()
        seeded = render_seeded_item_with_generation(item, file_change, RULES[0], None)
        assert seeded["generation_source"] == "deterministic_fallback"

    def test_all_checks_pass_uses_llm_path_and_ignores_self_reported_line(self):
        item, file_change = self._gold_item_and_file()

        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=_MUTATED_SINGLE_HUNK_GOOD,
                injected_line=999,  # deliberately wrong; must be ignored
                reachability_rationale="Reached via the init flow.",
            )

        seeded = render_seeded_item_with_generation(
            item, file_change, RULES[0], generate_fn
        )
        assert seeded["generation_source"] == "llm"
        assert seeded["must_find"][0]["line"] == 3
        assert seeded["reachability_rationale"] == "Reached via the init flow."

    def test_failed_v3_falls_back_to_deterministic(self):
        item, file_change = self._gold_item_and_file()

        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=(
                    "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+somethingElse();"
                ),
                injected_line=3,
                reachability_rationale="no eval here",
            )

        seeded = render_seeded_item_with_generation(
            item, file_change, RULES[0], generate_fn
        )
        assert seeded["generation_source"] == "deterministic_fallback"

    def test_generate_fn_returns_none_falls_back(self):
        item, file_change = self._gold_item_and_file()
        seeded = render_seeded_item_with_generation(
            item, file_change, RULES[0], lambda patch, rule, lang: None
        )
        assert seeded["generation_source"] == "deterministic_fallback"

    def test_ambiguous_recompute_falls_back_even_though_v1_v4_pass(self):
        item, file_change = self._gold_item_and_file()

        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=(
                    "@@ -1,2 +1,4 @@\n context1\n+eval(a);\n+addedByPr\n+eval(b);"
                ),
                injected_line=2,
                reachability_rationale="two spots",
            )

        seeded = render_seeded_item_with_generation(
            item, file_change, RULES[0], generate_fn
        )
        assert seeded["generation_source"] == "deterministic_fallback"


class TestBuildSeededItemsGenerationSourceWiring:
    def test_generate_fn_wired_through_to_each_item(self):
        item = make_gold_item(
            files=[make_file("src/foo.ts", patch=_ORIGINAL_SINGLE_HUNK)]
        )

        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=_MUTATED_SINGLE_HUNK_GOOD,
                injected_line=999,
                reachability_rationale="ok",
            )

        items, _ = build_seeded_items(
            item, [RULES[0]], random.Random(1), 1, generate_fn
        )
        assert items[0]["generation_source"] == "llm"

    def test_default_generate_fn_none_preserves_phase1_behavior(self):
        item = make_gold_item(files=[make_file("src/foo.ts"), make_file("src/bar.js")])
        items, _ = build_seeded_items(item, RULES, random.Random(1), 2)
        assert all(i["generation_source"] == "deterministic_fallback" for i in items)


class TestMainCLIModelConfigValidation:
    def _write_gold(self, tmp_path, items):
        path = tmp_path / "gold.jsonl"
        with open(path, "w", encoding="utf-8") as f:
            for item in items:
                f.write(json.dumps(item) + "\n")
        return path

    def _write_catalog(self, tmp_path, rules):
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps({"rules": rules}))
        return path

    def _gold_and_catalog(self, tmp_path):
        gold_items = [
            {
                "id": "owner/repo#1",
                "repository": "owner/repo",
                "pr_number": 1,
                "file_changes": [make_file("src/foo.ts")],
            }
        ]
        return (
            self._write_gold(tmp_path, gold_items),
            self._write_catalog(tmp_path, RULES),
        )

    def test_exits_with_error_when_no_model_configured(
        self, tmp_path, monkeypatch, capsys
    ):
        # Hermetic regardless of the real .env: load_dotenv() would
        # otherwise re-populate SEEDED_GEN_MODEL_ID from disk after
        # delenv, silently invalidating this test the moment that key is
        # ever set in a real .env (see evaluation/RUNBOOK.md).
        monkeypatch.setattr(build_seeded_set, "load_dotenv", lambda *a, **k: None)
        monkeypatch.delenv("SEEDED_GEN_MODEL_ID", raising=False)
        monkeypatch.delenv("SEEDED_GEN_LLM_BASE_URL", raising=False)
        gold_path, catalog_path = self._gold_and_catalog(tmp_path)
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
            ],
        )

        exit_code = main()

        assert exit_code == 1
        captured = capsys.readouterr()
        assert "[SEEDED-ERROR]" in captured.err
        assert not output_path.exists()

    def test_cli_model_id_takes_priority_over_env(self, tmp_path, monkeypatch):
        monkeypatch.setattr(build_seeded_set, "load_dotenv", lambda *a, **k: None)
        monkeypatch.setenv("SEEDED_GEN_MODEL_ID", "env-model")
        mock_factory = MagicMock(
            side_effect=lambda model_id, llm_base_url=None: (
                lambda patch, rule, lang: None
            )
        )
        monkeypatch.setattr(
            build_seeded_set, "make_llm_mutation_generator", mock_factory
        )
        gold_path, catalog_path = self._gold_and_catalog(tmp_path)
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
                "--model-id",
                "cli-model",
            ],
        )

        exit_code = main()

        assert exit_code == 0
        assert mock_factory.call_args.args[0] == "cli-model"

    def test_env_var_used_when_cli_not_provided(self, tmp_path, monkeypatch):
        monkeypatch.setattr(build_seeded_set, "load_dotenv", lambda *a, **k: None)
        monkeypatch.setenv("SEEDED_GEN_MODEL_ID", "env-model")
        mock_factory = MagicMock(
            side_effect=lambda model_id, llm_base_url=None: (
                lambda patch, rule, lang: None
            )
        )
        monkeypatch.setattr(
            build_seeded_set, "make_llm_mutation_generator", mock_factory
        )
        gold_path, catalog_path = self._gold_and_catalog(tmp_path)
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
            ],
        )

        exit_code = main()

        assert exit_code == 0
        assert mock_factory.call_args.args[0] == "env-model"


class TestMainCLIEndToEnd:
    def _write_gold(self, tmp_path, items):
        path = tmp_path / "gold.jsonl"
        with open(path, "w", encoding="utf-8") as f:
            for item in items:
                f.write(json.dumps(item) + "\n")
        return path

    def _write_catalog(self, tmp_path, rules):
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps({"rules": rules}))
        return path

    def _run(self, tmp_path, monkeypatch, generate_fn):
        gold_items = [
            {
                "id": "owner/repo#1",
                "repository": "owner/repo",
                "pr_number": 1,
                "file_changes": [make_file("src/foo.ts", patch=_ORIGINAL_SINGLE_HUNK)],
            }
        ]
        gold_path = self._write_gold(tmp_path, gold_items)
        catalog_path = self._write_catalog(tmp_path, [RULES[0]])
        output_path = tmp_path / "seeded.jsonl"
        monkeypatch.setattr(build_seeded_set, "load_dotenv", lambda *a, **k: None)
        monkeypatch.setattr(
            build_seeded_set,
            "make_llm_mutation_generator",
            lambda model_id, llm_base_url=None: generate_fn,
        )
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "build_seeded_set.py",
                "--gold",
                str(gold_path),
                "--catalog",
                str(catalog_path),
                "--output",
                str(output_path),
                "--model-id",
                "test-model",
            ],
        )

        exit_code = main()
        assert exit_code == 0
        lines = output_path.read_text().strip().splitlines()
        return [json.loads(line) for line in lines]

    def test_llm_path_produces_generation_source_llm(self, tmp_path, monkeypatch):
        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=_MUTATED_SINGLE_HUNK_GOOD,
                injected_line=999,
                reachability_rationale="Reached via the init flow.",
            )

        items = self._run(tmp_path, monkeypatch, generate_fn)

        assert len(items) == 1
        assert items[0]["generation_source"] == "llm"
        assert items[0]["must_find"][0]["line"] == 3

    def test_llm_path_failure_falls_back_and_output_not_empty(
        self, tmp_path, monkeypatch
    ):
        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=(
                    "@@ -1,2 +1,3 @@\n context1\n+addedByPr\n+somethingElse();"
                ),
                injected_line=3,
                reachability_rationale="no eval token",
            )

        items = self._run(tmp_path, monkeypatch, generate_fn)

        assert len(items) == 1
        assert items[0]["generation_source"] == "deterministic_fallback"


class TestRegressionKnownMisses:
    """Golden regression for the hoppscotch#6171 miss (js_eval_injection)
    that originally motivated this whole redesign: the LLM path must land
    the mutation in the resolver body, and a bad LLM output must fall
    back to Phase 1's own known-good placement rather than corrupting the
    dataset (design doc 1.1, 5).
    """

    _GOOD_MUTATED_PATCH = (
        "@@ -1,4 +1,5 @@\n"
        " import { Injectable } from '@nestjs/common';\n"
        " import { Resolver, Query, Args } from '@nestjs/graphql';\n"
        "+import { PublishedDocsService } from './published-docs.service';\n"
        " import { Logger } from '@nestjs/common';\n"
        " \n"
        "@@ -10,6 +11,12 @@ export class PublishedDocsResolver {\n"
        "   constructor(private readonly service: PublishedDocsService) {}\n"
        " \n"
        "   @Query(() => PublishedDoc)\n"
        "   async publishedDoc(@Args('id') id: string): Promise<PublishedDoc> {\n"
        "+    const doc = await this.service.findById(id);\n"
        "+    const result = eval(userInput);\n"
        "+    if (!doc) {\n"
        "+      throw new NotFoundException('Document not found');\n"
        "+    }\n"
        "+    return doc;\n"
        "   }\n"
        " }"
    )

    _BAD_MUTATED_PATCH = (
        "@@ -1,4 +1,5 @@\n"
        " import { Injectable } from '@nestjs/common';\n"
        " import { Resolver, Query, Args } from '@nestjs/graphql';\n"
        "+import { PublishedDocsService } from './published-docs.service';\n"
        " import { Logger } from '@nestjs/common';\n"
        " \n"
        "@@ -10,6 +11,12 @@ export class PublishedDocsResolver {\n"
        "   constructor(private readonly service: PublishedDocsService) {}\n"
        " \n"
        "   @Query(() => PublishedDoc)\n"
        "   async publishedDoc(@Args('id') id: string): Promise<PublishedDoc> {\n"
        "+    const doc = await this.service.findById(id);\n"
        "+    const result = Function(userInput)();\n"
        "+    if (!doc) {\n"
        "+      throw new NotFoundException('Document not found');\n"
        "+    }\n"
        "+    return doc;\n"
        "   }\n"
        " }"
    )

    def _rule(self):
        return {
            "rule_id": "js_eval_injection",
            "category": "security",
            "severity": "critical",
            "languages": ["ts"],
            "runtime": "universal",
            "required_tokens": [r"\beval\("],
            "line_snippet": "eval(userInput);",
            "language_snippets": {"ts": "eval(userInput);"},
            "summary": "Unsanitized eval usage may lead to arbitrary code execution.",
        }

    def _gold_item_and_file(self):
        patch = _published_docs_resolver_patch()
        item = make_gold_item(
            id="hoppscotch/hoppscotch#6171",
            files=[make_file("published-docs.resolver.ts", patch=patch)],
        )
        return item, item["file_changes"][0]

    def test_good_llm_output_lands_in_resolver_body_not_import_block(self):
        item, file_change = self._gold_item_and_file()

        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=self._GOOD_MUTATED_PATCH,
                injected_line=999,  # deliberately wrong; must be ignored
                reachability_rationale=(
                    "eval() runs right after the document is fetched, "
                    "before the null check -- reachable on every call."
                ),
            )

        seeded = render_seeded_item_with_generation(
            item, file_change, self._rule(), generate_fn
        )

        assert seeded["generation_source"] == "llm"
        assert seeded["must_find"][0]["line"] == 16
        import_hunk_text = seeded["file_changes"][0]["patch"].split("@@ -10")[0]
        assert "eval(" not in import_hunk_text

    def test_bad_llm_output_falls_back_to_phase1_known_good_placement(self):
        item, file_change = self._gold_item_and_file()

        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=self._BAD_MUTATED_PATCH,
                injected_line=16,
                reachability_rationale="uses the Function constructor instead",
            )

        seeded = render_seeded_item_with_generation(
            item, file_change, self._rule(), generate_fn
        )

        expected_patch, expected_line = inject_patch(
            file_change["patch"], "eval(userInput);"
        )
        assert seeded["generation_source"] == "deterministic_fallback"
        assert seeded["must_find"][0]["line"] == expected_line
        assert seeded["file_changes"][0]["patch"] == expected_patch


class TestRegressionKnownMissesVuetifyTsx:
    """Golden regression for the second known miss named in design doc 5:
    vuetify#22788 VDataTableFooter.tsx (js_eval_injection). Unlike the
    hoppscotch#6171 fixture (NestJS/TypeScript resolver body), this
    models a `.tsx` component render function -- a different
    `language_snippets` variant (`tsx`, with a type annotation) and a
    JSX-returning function body shape, so it is not redundant with the
    other fixture.

    This is a synthetic patch modeled on the reported scenario (a
    Vuetify data-table footer component), not a literal reproduction of
    the real PR's diff.
    """

    _ORIGINAL_PATCH = (
        "@@ -1,3 +1,4 @@\n"
        " import { defineComponent, computed } from 'vue';\n"
        " import type { PropType } from 'vue';\n"
        "+import { useDisplay } from 'vuetify';\n"
        " import './VDataTableFooter.css';\n"
        "@@ -15,5 +16,10 @@ export default defineComponent({\n"
        "   setup(props) {\n"
        "   const currentPage = computed(() => props.page);\n"
        "   const totalItems = computed(() => props.itemsLength);\n"
        "+    const pageText = computed(() => "
        "`${currentPage.value} of ${totalItems.value}`);\n"
        "+    return () => (\n"
        '+      <div class="v-data-table-footer">\n'
        "+        <span>{pageText.value}</span>\n"
        "+      </div>\n"
        "+    );\n"
        "   },\n"
        "   });"
    )

    _GOOD_MUTATED_PATCH = (
        "@@ -1,3 +1,4 @@\n"
        " import { defineComponent, computed } from 'vue';\n"
        " import type { PropType } from 'vue';\n"
        "+import { useDisplay } from 'vuetify';\n"
        " import './VDataTableFooter.css';\n"
        "@@ -15,5 +16,11 @@ export default defineComponent({\n"
        "   setup(props) {\n"
        "   const currentPage = computed(() => props.page);\n"
        "   const totalItems = computed(() => props.itemsLength);\n"
        "+    const pageText = computed(() => "
        "`${currentPage.value} of ${totalItems.value}`);\n"
        "+    const debugResult: unknown = eval(getQueryParam('q'));\n"
        "+    return () => (\n"
        '+      <div class="v-data-table-footer">\n'
        "+        <span>{pageText.value}</span>\n"
        "+      </div>\n"
        "+    );\n"
        "   },\n"
        "   });"
    )

    _BAD_MUTATED_PATCH = (
        "@@ -1,3 +1,4 @@\n"
        " import { defineComponent, computed } from 'vue';\n"
        " import type { PropType } from 'vue';\n"
        "+import { useDisplay } from 'vuetify';\n"
        " import './VDataTableFooter.css';\n"
        "@@ -15,5 +16,11 @@ export default defineComponent({\n"
        "   setup(props) {\n"
        "   const currentPage = computed(() => props.page);\n"
        "   const totalItems = computed(() => props.itemsLength);\n"
        "+    const pageText = computed(() => "
        "`${currentPage.value} of ${totalItems.value}`);\n"
        "+    const debugResult = getQueryParam('q');\n"
        "+    return () => (\n"
        '+      <div class="v-data-table-footer">\n'
        "+        <span>{pageText.value}</span>\n"
        "+      </div>\n"
        "+    );\n"
        "   },\n"
        "   });"
    )

    def _rule(self):
        return {
            "rule_id": "js_eval_injection",
            "category": "security",
            "severity": "critical",
            "languages": ["tsx"],
            "runtime": "universal",
            "required_tokens": [r"\beval\("],
            "line_snippet": "eval(userInput);",
            "language_snippets": {
                "tsx": "const result: unknown = eval(getQueryParam('q'));"
            },
            "summary": "Unsanitized eval usage may lead to arbitrary code execution.",
        }

    def _gold_item_and_file(self):
        item = make_gold_item(
            id="vuetifyjs/vuetify#22788",
            files=[
                make_file(
                    "src/components/VDataTableFooter.tsx", patch=self._ORIGINAL_PATCH
                )
            ],
        )
        return item, item["file_changes"][0]

    def test_good_llm_output_lands_in_render_body_not_import_block(self):
        item, file_change = self._gold_item_and_file()

        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=self._GOOD_MUTATED_PATCH,
                injected_line=999,  # deliberately wrong; must be ignored
                reachability_rationale=(
                    "eval() runs during setup(), on every render of this "
                    "component -- unconditionally reachable."
                ),
            )

        seeded = render_seeded_item_with_generation(
            item, file_change, self._rule(), generate_fn
        )

        assert seeded["generation_source"] == "llm"
        assert seeded["must_find"][0]["line"] == 20
        import_hunk_text = seeded["file_changes"][0]["patch"].split("@@ -15")[0]
        assert "eval(" not in import_hunk_text

    def test_bad_llm_output_falls_back_to_phase1_known_good_placement(self):
        item, file_change = self._gold_item_and_file()

        def generate_fn(patch, rule, lang):
            return MutatedPatchOutput(
                mutated_patch=self._BAD_MUTATED_PATCH,
                injected_line=20,
                reachability_rationale="missing the eval( call entirely",
            )

        rule = self._rule()
        seeded = render_seeded_item_with_generation(
            item, file_change, rule, generate_fn
        )

        expected_patch, expected_line = inject_patch(
            file_change["patch"], get_snippet_for_lang(rule, "tsx")
        )
        assert seeded["generation_source"] == "deterministic_fallback"
        assert seeded["must_find"][0]["line"] == expected_line
        assert seeded["file_changes"][0]["patch"] == expected_patch


class TestRegressionIssue131SelfContainedSnippets:
    """Issue #131: `frontend_n_plus_one_api` / `b2b2c_idor_hint` previously
    required `await` in `required_tokens`, which implicitly requires the
    enclosing function to be `async`. Since injection must be pure addition
    (V2), this forced an LLM to rewrite a sync arrow function's signature --
    exactly the structural edit V2 exists to reject (6/7 of the observed
    fallback cases). The revised catalog snippets (Promise-chain for the
    N+1 rule, plain `.then()` for the IDOR rule) must inject into a sync
    context via pure addition, while a genuine structural rewrite (the
    original failure mode) must still fail V2."""

    _CATALOG_PATH = (
        Path(__file__).parents[3] / "evaluation" / "config" / "seeded_mutations.json"
    )

    def _rule(self, rule_id):
        catalog = json.loads(self._CATALOG_PATH.read_text(encoding="utf-8"))
        return next(r for r in catalog["rules"] if r["rule_id"] == rule_id)

    # A synchronous arrow function with an expression body -- the exact
    # shape (gitbutler main.ts) that previously triggered an async rewrite.
    _SYNC_ARROW_ORIGINAL = (
        "@@ -1,2 +1,2 @@\n"
        " context1\n"
        "+const openLink = (_e, url: string) => shell.openExternal(url);"
    )

    @pytest.mark.parametrize("rule_id", ["frontend_n_plus_one_api", "b2b2c_idor_hint"])
    def test_required_tokens_do_not_depend_on_await(self, rule_id):
        rule = self._rule(rule_id)
        assert not any("await" in token for token in rule["required_tokens"])

    @pytest.mark.parametrize("rule_id", ["frontend_n_plus_one_api", "b2b2c_idor_hint"])
    def test_snippet_does_not_use_await(self, rule_id):
        rule = self._rule(rule_id)
        for lang, snippet in rule["language_snippets"].items():
            assert "await" not in snippet, f"{rule_id}/{lang}: {snippet!r}"

    @pytest.mark.parametrize("rule_id", ["frontend_n_plus_one_api", "b2b2c_idor_hint"])
    def test_injects_into_sync_arrow_function_via_pure_addition(self, rule_id):
        rule = self._rule(rule_id)
        snippet = get_snippet_for_lang(rule, "ts")
        mutated = (
            "@@ -1,2 +1,3 @@\n"
            " context1\n"
            "+const openLink = (_e, url: string) => shell.openExternal(url);\n"
            f"+{snippet}"
        )
        assert verify_only_additions_changed(self._SYNC_ARROW_ORIGINAL, mutated) is True
        assert (
            verify_required_tokens(
                self._SYNC_ARROW_ORIGINAL, mutated, rule["required_tokens"]
            )
            is True
        )

    def test_structural_async_rewrite_of_sync_arrow_still_fails_v2(self):
        # The original failure mode: instead of adding the snippet
        # untouched, the LLM rewrites the pre-existing arrow function to
        # `async` so that `await` (previously required) type-checks.
        mutated = (
            "@@ -1,2 +1,5 @@\n"
            " context1\n"
            "+const openLink = async (_e, url: string) => {\n"
            "+  await fetch('/api/items/' + params.id);\n"
            "+  shell.openExternal(url);\n"
            "+};"
        )
        assert (
            verify_only_additions_changed(self._SYNC_ARROW_ORIGINAL, mutated) is False
        )
