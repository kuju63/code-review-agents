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

import pytest

from tests.evaluation.conftest import load_eval_tool_module

build_seeded_set = load_eval_tool_module("build_seeded_set", "build_seeded_set.py")

candidate_files = build_seeded_set.candidate_files
enumerate_combo_pool = build_seeded_set.enumerate_combo_pool
render_seeded_item = build_seeded_set.render_seeded_item
build_seeded_items = build_seeded_set.build_seeded_items
main = build_seeded_set.main

RULES = [
    {
        "rule_id": "rule_a",
        "languages": ["js", "ts"],
        "category": "security",
        "severity": "high",
        "summary": "Rule A summary",
        "line_snippet": "eval(userInput);",
    },
    {
        "rule_id": "rule_b",
        "languages": ["js"],
        "category": "security",
        "severity": "medium",
        "summary": "Rule B summary",
        "line_snippet": "el.innerHTML = data;",
    },
    {
        "rule_id": "rule_c",
        "languages": ["ts"],
        "category": "performance",
        "severity": "low",
        "summary": "Rule C summary",
        "line_snippet": "await Promise.all(items.map(fn));",
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

    def test_no_duplicate_ids_in_output(self, tmp_path, monkeypatch):
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
