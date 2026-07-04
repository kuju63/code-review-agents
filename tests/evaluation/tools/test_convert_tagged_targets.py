"""Tests for evaluation/tools/convert_tagged_targets.py.

Covers: repo_type ingestion, the new stratified-random sampling mode
(select_stratified / allocate_quota), the coverage-warning summary, and a
golden-output regression for the pre-existing (non-stratified) selection path.
"""

from __future__ import annotations

import json
import sys

import pytest

from tests.evaluation.conftest import load_eval_tool_module

convert_tagged_targets = load_eval_tool_module(
    "convert_tagged_targets", "convert_tagged_targets.py"
)

TaggedTarget = convert_tagged_targets.TaggedTarget
load_tagged = convert_tagged_targets.load_tagged
filter_rows = convert_tagged_targets.filter_rows
dedupe_rows = convert_tagged_targets.dedupe_rows
select_balanced = convert_tagged_targets.select_balanced
select_stratified = convert_tagged_targets.select_stratified
allocate_quota = convert_tagged_targets.allocate_quota
summarize = convert_tagged_targets.summarize
check_coverage_thresholds = convert_tagged_targets.check_coverage_thresholds
main = convert_tagged_targets.main


def make_row(
    repository="owner/repo",
    pr_number=1,
    stack="react",
    repo_type="application",
    risk_priority="medium",
    priority_themes=(),
):
    return TaggedTarget(
        repository=repository,
        pr_number=pr_number,
        stack=stack,
        repo_type=repo_type,
        risk_priority=risk_priority,
        priority_themes=tuple(priority_themes),
    )


class TestLoadTaggedRepoType:
    def test_reads_repo_type_when_present(self, tmp_path):
        path = tmp_path / "tagged.json"
        path.write_text(
            json.dumps(
                [
                    {
                        "repository": "a/b",
                        "pr_number": 1,
                        "stack": "react",
                        "repo_type": "ui-library",
                        "risk_priority": "high",
                        "priority_themes": ["security"],
                    }
                ]
            )
        )
        rows = load_tagged(str(path))
        assert rows[0].repo_type == "ui-library"

    def test_defaults_to_unknown_when_missing(self, tmp_path):
        path = tmp_path / "tagged.json"
        path.write_text(
            json.dumps(
                [
                    {
                        "repository": "a/b",
                        "pr_number": 1,
                        "stack": "react",
                        "risk_priority": "high",
                        "priority_themes": [],
                    }
                ]
            )
        )
        rows = load_tagged(str(path))
        assert rows[0].repo_type == "unknown"


class TestFilterAndDedupeUnchanged:
    def test_filter_rows_by_min_risk(self):
        rows = [
            make_row(pr_number=1, risk_priority="low"),
            make_row(pr_number=2, risk_priority="medium"),
            make_row(pr_number=3, risk_priority="high"),
        ]
        out = filter_rows(rows, stacks=set(), min_risk="medium", themes_any=set())
        assert {r.pr_number for r in out} == {2, 3}

    def test_dedupe_rows_keeps_first_occurrence(self):
        rows = [
            make_row(repository="a/b", pr_number=1, stack="react"),
            make_row(repository="a/b", pr_number=1, stack="vue"),
        ]
        out = dedupe_rows(rows)
        assert len(out) == 1
        assert out[0].stack == "react"


class TestSelectBalancedBackwardCompatible:
    def test_default_sorts_by_risk_descending_within_stack(self):
        rows = [
            make_row(pr_number=1, stack="react", risk_priority="low"),
            make_row(pr_number=2, stack="react", risk_priority="high"),
        ]
        out = select_balanced(rows, limit=2)
        assert [r.pr_number for r in out] == [2, 1]

    def test_sort_by_risk_false_preserves_input_order(self):
        rows = [
            make_row(pr_number=1, stack="react", risk_priority="low"),
            make_row(pr_number=2, stack="react", risk_priority="high"),
        ]
        out = select_balanced(rows, limit=2, sort_by_risk=False)
        assert [r.pr_number for r in out] == [1, 2]

    def test_round_robin_across_stacks(self):
        rows = [
            make_row(pr_number=1, stack="react"),
            make_row(pr_number=2, stack="react"),
            make_row(pr_number=3, stack="vue"),
        ]
        out = select_balanced(rows, limit=2)
        stacks = {r.stack for r in out}
        assert stacks == {"react", "vue"}


class TestAllocateQuota:
    def test_even_split_when_stock_sufficient(self):
        strata = {
            "application": [make_row(pr_number=i) for i in range(10)],
            "ui-library": [make_row(pr_number=i) for i in range(10, 20)],
        }
        quota = allocate_quota(10, ["application", "ui-library"], strata)
        assert sum(quota.values()) == 10
        assert quota["application"] == 5
        assert quota["ui-library"] == 5

    def test_clamps_to_stock_and_redistributes_shortfall(self):
        strata = {
            "application": [make_row(pr_number=i) for i in range(2)],
            "ui-library": [make_row(pr_number=i) for i in range(10, 20)],
        }
        quota = allocate_quota(10, ["application", "ui-library"], strata)
        assert quota["application"] == 2
        assert quota["ui-library"] == 8
        assert sum(quota.values()) == 10

    def test_never_exceeds_total_available_stock(self):
        strata = {
            "application": [make_row(pr_number=1)],
            "ui-library": [make_row(pr_number=2)],
        }
        quota = allocate_quota(10, ["application", "ui-library"], strata)
        assert sum(quota.values()) == 2


class TestSelectStratified:
    def _mixed_rows(self):
        rows = []
        for i in range(10):
            rows.append(make_row(pr_number=i, stack="react", repo_type="application"))
        for i in range(10, 20):
            rows.append(make_row(pr_number=i, stack="vue", repo_type="ui-library"))
        return rows

    def test_splits_roughly_evenly_by_repo_type(self):
        rows = self._mixed_rows()
        out = select_stratified(rows, limit=10, seed=42, balanced=True)
        by_type = {}
        for r in out:
            by_type[r.repo_type] = by_type.get(r.repo_type, 0) + 1
        assert len(out) == 10
        assert by_type.get("application", 0) == 5
        assert by_type.get("ui-library", 0) == 5

    def test_backfills_without_crashing_when_a_stratum_is_scarce(self):
        rows = [make_row(pr_number=0, stack="angular", repo_type="application")]
        rows += [
            make_row(pr_number=i, stack="react", repo_type="ui-library")
            for i in range(1, 20)
        ]
        out = select_stratified(rows, limit=10, seed=42, balanced=True)
        assert len(out) == 10

    def test_deterministic_for_fixed_seed(self):
        rows = self._mixed_rows()
        out_a = select_stratified(rows, limit=8, seed=7, balanced=True)
        out_b = select_stratified(rows, limit=8, seed=7, balanced=True)
        assert [r.pr_number for r in out_a] == [r.pr_number for r in out_b]

    def test_never_exceeds_total_rows(self):
        rows = self._mixed_rows()
        out = select_stratified(rows, limit=1000, seed=1, balanced=True)
        assert len(out) == len(rows)


class TestSummarize:
    def test_reports_repo_type_and_stack_by_repo_type(self):
        rows = [
            make_row(pr_number=1, stack="react", repo_type="application"),
            make_row(pr_number=2, stack="vue", repo_type="ui-library"),
        ]
        summary = summarize(rows)
        assert summary["repo_type_distribution"] == {"application": 1, "ui-library": 1}
        assert summary["stack_distribution_by_repo_type"]["application"] == {"react": 1}
        assert summary["stack_distribution_by_repo_type"]["ui-library"] == {"vue": 1}

    def test_theme_category_distribution_maps_known_themes(self):
        rows = [
            make_row(pr_number=1, priority_themes=["security", "auth"]),
            make_row(pr_number=2, priority_themes=["correctness"]),
        ]
        summary = summarize(rows)
        assert summary["theme_category_distribution"]["security"] == 1
        assert summary["theme_category_distribution"]["correctness_side_effect"] == 1

    def test_unmapped_theme_falls_back_to_other(self):
        rows = [make_row(pr_number=1, priority_themes=["css"])]
        summary = summarize(rows)
        assert summary["theme_category_distribution"].get("other") == 1

    def test_existing_keys_still_present(self):
        rows = [make_row(pr_number=1)]
        summary = summarize(rows)
        assert "total" in summary
        assert "stack_distribution" in summary
        assert "risk_distribution" in summary


class TestCheckCoverageThresholds:
    def test_warns_when_repo_type_ratio_far_from_50_50(self):
        rows = [
            make_row(pr_number=i, repo_type="application", stack="react")
            for i in range(10)
        ]
        summary = summarize(rows)
        warnings = check_coverage_thresholds(rows, summary)
        assert any("repo_type" in w for w in warnings)

    def test_no_repo_type_warning_when_balanced_and_stacks_satisfy_minimums(self):
        rows = [
            make_row(pr_number=i, repo_type="application", stack="react")
            for i in range(4)
        ] + [
            make_row(pr_number=i, repo_type="ui-library", stack="react")
            for i in range(10, 14)
        ]
        summary = summarize(rows)
        warnings = check_coverage_thresholds(rows, summary)
        assert not any("repo_type=" in w for w in warnings)


class TestMainExitCodeAndCLI:
    def _write_tagged(self, tmp_path, rows):
        path = tmp_path / "tagged.json"
        path.write_text(json.dumps(rows))
        return path

    def test_exit_code_is_always_zero_even_with_coverage_warnings(
        self, tmp_path, monkeypatch, capsys
    ):
        rows = [
            {
                "repository": "a/b",
                "pr_number": i,
                "stack": "react",
                "repo_type": "application",
                "risk_priority": "high",
                "priority_themes": [],
            }
            for i in range(5)
        ]
        input_path = self._write_tagged(tmp_path, rows)
        output_path = tmp_path / "out.json"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "convert_tagged_targets.py",
                "--input",
                str(input_path),
                "--output",
                str(output_path),
                "--limit",
                "5",
                "--print-summary",
            ],
        )
        exit_code = main()
        assert exit_code == 0
        captured = capsys.readouterr()
        assert "[COVERAGE-WARN]" in captured.err

    def test_stratify_repo_type_requires_shuffle(self, tmp_path, monkeypatch):
        input_path = self._write_tagged(tmp_path, [])
        output_path = tmp_path / "out.json"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "convert_tagged_targets.py",
                "--input",
                str(input_path),
                "--output",
                str(output_path),
                "--limit",
                "5",
                "--stratify-repo-type",
            ],
        )
        with pytest.raises(SystemExit) as exc_info:
            main()
        assert exc_info.value.code == 2

    def test_legacy_limit_balanced_output_unchanged(self, tmp_path, monkeypatch):
        rows = [
            {
                "repository": "a/b",
                "pr_number": i,
                "stack": "react" if i % 2 == 0 else "vue",
                "repo_type": "application",
                "risk_priority": "high" if i < 3 else "medium",
                "priority_themes": [],
            }
            for i in range(6)
        ]
        input_path = self._write_tagged(tmp_path, rows)
        output_path = tmp_path / "out.json"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "convert_tagged_targets.py",
                "--input",
                str(input_path),
                "--output",
                str(output_path),
                "--limit",
                "4",
                "--min-risk",
                "medium",
                "--balanced",
            ],
        )
        exit_code = main()
        assert exit_code == 0
        result = json.loads(output_path.read_text())
        assert result == [
            {"repository": "a/b", "pr_number": 0},
            {"repository": "a/b", "pr_number": 1},
            {"repository": "a/b", "pr_number": 2},
            {"repository": "a/b", "pr_number": 3},
        ]
