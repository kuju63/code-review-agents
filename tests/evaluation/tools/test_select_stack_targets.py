"""Tests for evaluation/tools/select_stack_targets.py."""

from __future__ import annotations

import json
import sys

import pytest

from tests.evaluation.conftest import load_eval_tool_module

selector = load_eval_tool_module("select_stack_targets", "select_stack_targets.py")

StackTarget = selector.StackTarget
allocate_quota = selector.allocate_quota
check_coverage_thresholds = selector.check_coverage_thresholds
dedupe_rows = selector.dedupe_rows
filter_rows = selector.filter_rows
load_targets = selector.load_targets
main = selector.main
select_balanced = selector.select_balanced
select_stratified = selector.select_stratified
summarize = selector.summarize


def make_row(
    repository="owner/repo",
    pr_number=1,
    stack="react",
    repo_type="application",
    severity="medium",
    impact="correctness",
    priority="medium",
):
    return StackTarget(
        repository=repository,
        pr_number=pr_number,
        stack=stack,
        repo_type=repo_type,
        severity=severity,
        impact=impact,
        priority=priority,
    )


def row_dict(**overrides):
    row = make_row(**overrides)
    return {
        "repository": row.repository,
        "pr_number": row.pr_number,
        "stack": row.stack,
        "repo_type": row.repo_type,
        "severity": row.severity,
        "impact": row.impact,
        "priority": row.priority,
    }


class TestLoadTargets:
    def test_loads_multiple_stack_files(self, tmp_path):
        react = tmp_path / "react.json"
        vue = tmp_path / "vue.json"
        react.write_text(json.dumps([row_dict(pr_number=1, stack="react")]))
        vue.write_text(json.dumps([row_dict(pr_number=2, stack="vue")]))
        rows = load_targets([str(react), str(vue)])
        assert [(r.pr_number, r.stack) for r in rows] == [(1, "react"), (2, "vue")]

    def test_rejects_invalid_enum(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps([row_dict(severity="urgent")]))
        with pytest.raises(ValueError, match=r"bad\.json\[0\].*severity"):
            load_targets([str(path)])

    def test_rejects_unknown_stack(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps([row_dict(stack="solid")]))
        with pytest.raises(ValueError, match=r"bad\.json\[0\].*stack"):
            load_targets([str(path)])

    def test_preserves_missing_field_message(self, tmp_path):
        path = tmp_path / "bad.json"
        row = row_dict()
        del row["impact"]
        path.write_text(json.dumps([row]))
        with pytest.raises(ValueError, match=r"missing impact at .*bad\.json\[0\]"):
            load_targets([str(path)])

    @pytest.mark.parametrize("invalid_pr_number", [None, "not-a-number"])
    def test_qualifies_invalid_pr_number_with_path_and_index(
        self, tmp_path, invalid_pr_number
    ):
        path = tmp_path / "bad.json"
        row = row_dict()
        row["pr_number"] = invalid_pr_number
        path.write_text(json.dumps([row]))
        with pytest.raises(ValueError, match=r"bad\.json\[0\].*pr_number"):
            load_targets([str(path)])


class TestFilterAndDedupe:
    def test_filters_all_three_axes_and_stack(self):
        rows = [
            make_row(
                pr_number=1,
                stack="react",
                severity="high",
                impact="security",
                priority="high",
            ),
            make_row(
                pr_number=2,
                stack="vue",
                severity="medium",
                impact="correctness",
                priority="medium",
            ),
            make_row(
                pr_number=3,
                stack="react",
                severity="low",
                impact="security",
                priority="low",
            ),
        ]
        selected = filter_rows(
            rows,
            stacks={"react"},
            min_severity="medium",
            impacts={"security"},
            priorities={"high"},
        )
        assert [r.pr_number for r in selected] == [1]

    def test_dedupe_keeps_first_occurrence(self):
        rows = [
            make_row(repository="a/b", pr_number=1, stack="react"),
            make_row(repository="a/b", pr_number=1, stack="vue"),
        ]
        assert dedupe_rows(rows) == [rows[0]]


class TestSelection:
    def test_balanced_round_robin_prioritizes_severity_then_priority(self):
        rows = [
            make_row(pr_number=1, stack="react", severity="low", priority="high"),
            make_row(pr_number=2, stack="react", severity="high", priority="low"),
            make_row(pr_number=3, stack="vue", severity="medium", priority="medium"),
        ]
        selected = select_balanced(rows, limit=3)
        assert [r.pr_number for r in selected] == [2, 3, 1]

    def test_allocate_quota_clamps_and_redistributes(self):
        strata = {
            "application": [make_row(pr_number=1)],
            "ui-library": [make_row(pr_number=i) for i in range(2, 12)],
        }
        quota = allocate_quota(6, ["application", "ui-library"], strata)
        assert quota == {"application": 1, "ui-library": 5}

    def test_stratified_is_balanced_and_deterministic(self):
        rows = [
            make_row(pr_number=i, repo_type="application", stack="react")
            for i in range(10)
        ] + [
            make_row(pr_number=i, repo_type="ui-library", stack="vue")
            for i in range(10, 20)
        ]
        first = select_stratified(rows, limit=8, seed=7, balanced=True)
        second = select_stratified(rows, limit=8, seed=7, balanced=True)
        assert [r.pr_number for r in first] == [r.pr_number for r in second]
        assert sum(r.repo_type == "application" for r in first) == 4
        assert sum(r.repo_type == "ui-library" for r in first) == 4


class TestSummaryAndCoverage:
    def test_summarizes_new_three_axes(self):
        rows = [
            make_row(severity="high", impact="security", priority="high"),
            make_row(
                pr_number=2,
                stack="vue",
                repo_type="ui-library",
                severity="low",
                impact="maintainability",
                priority="low",
            ),
        ]
        summary = summarize(rows)
        assert summary["severity_distribution"] == {"high": 1, "low": 1}
        assert summary["impact_distribution"] == {
            "maintainability": 1,
            "security": 1,
        }
        assert summary["priority_distribution"] == {"high": 1, "low": 1}

    def test_coverage_warns_when_impact_ratio_is_low(self):
        rows = [make_row(pr_number=i, impact="correctness") for i in range(10)]
        summary = summarize(rows)
        warnings = check_coverage_thresholds(rows, summary)
        assert any("impact=security" in warning for warning in warnings)


class TestMain:
    def test_writes_execution_targets_from_multiple_inputs(
        self, tmp_path, monkeypatch, capsys
    ):
        react = tmp_path / "react.json"
        vue = tmp_path / "vue.json"
        output = tmp_path / "out.json"
        react.write_text(
            json.dumps(
                [
                    row_dict(
                        pr_number=1,
                        stack="react",
                        severity="high",
                        impact="security",
                        priority="high",
                    )
                ]
            )
        )
        vue.write_text(
            json.dumps(
                [
                    row_dict(
                        pr_number=2,
                        stack="vue",
                        severity="low",
                        impact="maintainability",
                        priority="low",
                    )
                ]
            )
        )
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "select_stack_targets.py",
                "--inputs",
                str(react),
                str(vue),
                "--output",
                str(output),
                "--min-severity",
                "medium",
                "--impact",
                "security",
                "--print-summary",
            ],
        )
        assert main() == 0
        assert json.loads(output.read_text()) == [
            {"repository": "owner/repo", "pr_number": 1}
        ]
        summary = json.loads(capsys.readouterr().out)
        assert summary["total"] == 1

    def test_shuffle_balanced_preserves_shuffled_order(self, tmp_path, monkeypatch):
        path = tmp_path / "input.json"
        output = tmp_path / "out.json"
        path.write_text(
            json.dumps(
                [
                    row_dict(pr_number=1, severity="critical", priority="high"),
                    row_dict(pr_number=2, severity="high", priority="medium"),
                    row_dict(pr_number=3, severity="low", priority="low"),
                    row_dict(pr_number=4, severity="low", priority="low"),
                ]
            )
        )
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "select_stack_targets.py",
                "--inputs",
                str(path),
                "--output",
                str(output),
                "--limit",
                "2",
                "--shuffle",
                "--balanced",
                "--seed",
                "42",
            ],
        )
        assert main() == 0
        assert [row["pr_number"] for row in json.loads(output.read_text())] == [3, 2]

    def test_stratify_requires_shuffle(self, tmp_path, monkeypatch):
        path = tmp_path / "input.json"
        path.write_text("[]")
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "select_stack_targets.py",
                "--inputs",
                str(path),
                "--output",
                str(tmp_path / "out.json"),
                "--limit",
                "5",
                "--stratify-repo-type",
            ],
        )
        with pytest.raises(SystemExit) as exc_info:
            main()
        assert exc_info.value.code == 2
