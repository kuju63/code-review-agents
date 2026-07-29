"""Tests for evaluation/tools/generate_evaluation_report.py::_build_report.

Covers the per-item detail rendering added on top of the existing
aggregate-only report: Gold PR sections showing human_findings vs
agent_findings (matched/missed/unmatched), Seeded item sections showing
must_find vs agent_findings with no "human review" wording, and the
_sanitize_cell/_ref_cell table-cell helpers.

_build_report and friends used to live in run_agent_evaluation.py; they
moved here (see docs/eval-sharded-execution-spec.md) so scoring/report
generation can run independently of the A2A evaluation step. The
assertions below are unchanged by that move.
"""

from __future__ import annotations

import pytest

from tests.evaluation.conftest import load_eval_tool_module

generate_evaluation_report = load_eval_tool_module(
    "generate_evaluation_report", "generate_evaluation_report.py"
)

_build_report = generate_evaluation_report._build_report
_sanitize_cell = generate_evaluation_report._sanitize_cell
_ref_cell = generate_evaluation_report._ref_cell
_finding_row = generate_evaluation_report._finding_row
_render_item_detail = generate_evaluation_report._render_item_detail
_gold_heading = generate_evaluation_report._gold_heading
_seeded_heading = generate_evaluation_report._seeded_heading


def make_scores(
    gold_items=None, seeded_items=None, gold_counts=None, seeded_counts=None
):
    return {
        "gold": {
            "issue_recall": 0.5,
            "issue_precision": 0.5,
            "severity_agreement": 0.5,
            "severity_exact_agreement": 0.5,
            "severity_within_one_agreement": 1.0,
            "impact_exact_agreement": 0.6,
            "priority_exact_agreement": 0.4,
            "priority_within_one_agreement": 0.8,
            "location_hit_rate": 0.5,
            "counts": gold_counts
            or {
                "gold_total": 1,
                "gold_matched": 1,
                "pred_total_for_gold": 1,
                "location_matched_exact": 1,
                "severity_labeled_pairs": 2,
                "severity_exact_matched": 1,
                "severity_within_one_matched": 2,
                "impact_labeled_pairs": 5,
                "impact_exact_matched": 3,
                "priority_labeled_pairs": 5,
                "priority_exact_matched": 2,
                "priority_within_one_matched": 4,
            },
            "items": gold_items or [],
        },
        "seeded": {
            "must_find_recall": 1.0,
            "critical_miss_rate": 0.0,
            "counts": seeded_counts
            or {
                "seeded_total": 0,
                "seeded_detected": 0,
                "seeded_critical_total": 0,
                "seeded_critical_missed": 0,
            },
            "items": seeded_items or [],
        },
    }


def make_gold_item_row(
    item_id="pr1",
    matched=None,
    missed=None,
    unmatched_agent=None,
    expected_total=0,
    agent_total=0,
):
    return {
        "id": item_id,
        "matched": matched or [],
        "missed": missed or [],
        "unmatched_agent": unmatched_agent or [],
        "expected_total": expected_total,
        "agent_total": agent_total,
    }


def make_raw_finding(
    path: str = "src/a.ts",
    line: int = 10,
    category: str = "security",
    severity: str = "high",
    impact: str = "security",
    priority: str = "high",
    summary: str | None = "xss via innerHTML",
    **extra,
):
    return {
        "path": path,
        "line": line,
        "category": category,
        "severity": severity,
        "impact": impact,
        "priority": priority,
        "summary": summary,
        **extra,
    }


class TestSanitizeCell:
    def test_collapses_newlines_and_tabs(self):
        assert _sanitize_cell("line1\nline2\tend") == "line1 line2 end"

    def test_escapes_pipe_character(self):
        assert _sanitize_cell("a | b") == "a \\| b"

    def test_truncates_long_text_with_ellipsis(self):
        text = "x" * 200
        result = _sanitize_cell(text, max_len=10)
        assert len(result) == 10
        assert result.endswith("…")

    def test_short_text_is_unchanged(self):
        assert _sanitize_cell("short") == "short"

    def test_none_is_treated_as_empty_string(self):
        assert _sanitize_cell(None) == ""

    def test_non_string_input_is_coerced(self):
        assert _sanitize_cell(42) == "42"


class TestRefCell:
    def test_source_present_renders_markdown_link(self):
        raw = make_raw_finding(source="https://github.com/o/r/pull/1#discussion_r1")
        assert _ref_cell(raw) == "[source](https://github.com/o/r/pull/1#discussion_r1)"

    def test_rule_id_present_renders_inline_code(self):
        raw = make_raw_finding(rule_id="js_eval_injection")
        assert _ref_cell(raw) == "`js_eval_injection`"

    def test_neither_present_renders_dash(self):
        raw = make_raw_finding()
        assert _ref_cell(raw) == "-"

    def test_source_takes_priority_over_rule_id(self):
        raw = make_raw_finding(source="https://x", rule_id="rule")
        assert _ref_cell(raw) == "[source](https://x)"


class TestFindingRow:
    def test_none_summary_does_not_raise(self):
        raw = make_raw_finding(summary=None)
        row = _finding_row("❌ 見逃し", raw)
        assert "❌ 見逃し" in row

    def test_pipe_in_path_is_escaped(self):
        raw = make_raw_finding(path="src/a|b.ts")
        row = _finding_row("✅ マッチ", raw)
        assert "src/a\\|b.ts" in row
        assert row.count("|") == row.count("\\|") + 9

    def test_newline_in_category_is_collapsed(self):
        raw = make_raw_finding(category="security\ninjected")
        row = _finding_row("✅ マッチ", raw)
        assert "\n" not in row

    def test_pipe_in_source_ref_is_escaped(self):
        raw = make_raw_finding(source="https://example.com/a|b")
        row = _finding_row("✅ マッチ", raw)
        assert "https://example.com/a\\|b" in row


class TestRenderItemDetail:
    def test_matched_row_rendered_with_check_mark(self):
        item = make_gold_item_row(
            matched=[
                {
                    "expected": make_raw_finding(summary="human said X"),
                    "agent": make_raw_finding(summary="agent said X"),
                    "severity_match": True,
                    "exact_line": True,
                }
            ],
            expected_total=1,
            agent_total=1,
        )
        text = _render_item_detail(item, "`pr1`", "人間レビュー指摘")
        assert "✅" in text
        assert "human said X" in text

    def test_missed_row_rendered_with_cross_mark(self):
        item = make_gold_item_row(
            missed=[make_raw_finding(summary="missed issue")], expected_total=1
        )
        text = _render_item_detail(item, "`pr1`", "人間レビュー指摘")
        assert "❌" in text
        assert "missed issue" in text

    def test_unmatched_agent_row_rendered_with_plus_mark(self):
        item = make_gold_item_row(
            unmatched_agent=[make_raw_finding(summary="agent-only issue")],
            agent_total=1,
        )
        text = _render_item_detail(item, "`pr1`", "人間レビュー指摘")
        assert "➕" in text
        assert "agent-only issue" in text
        assert "誤検知とは限らない" in text

    def test_empty_item_renders_placeholder(self):
        item = make_gold_item_row()
        text = _render_item_detail(item, "`pr1`", "人間レビュー指摘")
        assert "findings なし" in text

    def test_summary_line_reports_counts(self):
        item = make_gold_item_row(
            matched=[
                {
                    "expected": make_raw_finding(),
                    "agent": make_raw_finding(),
                    "severity_match": True,
                    "exact_line": True,
                }
            ],
            missed=[make_raw_finding(path="src/b.ts")],
            unmatched_agent=[make_raw_finding(path="src/c.ts")],
            expected_total=2,
            agent_total=2,
        )
        text = _render_item_detail(item, "`pr1`", "人間レビュー指摘")
        assert "人間レビュー指摘: 2 件" in text
        assert "マッチ: 1 件" in text
        assert "見逃し: 1 件" in text
        assert "Agentのみ: 1 件" in text

    def test_heading_is_used_as_is(self):
        item = make_gold_item_row()
        text = _render_item_detail(item, "`custom-heading`", "Must-Find")
        assert text.startswith("### `custom-heading`")


class TestGoldHeading:
    def test_includes_title_when_present(self):
        heading = _gold_heading("owner/repo#1", {"owner/repo#1": "Fix the bug"})
        assert "owner/repo#1" in heading
        assert "Fix the bug" in heading

    def test_falls_back_to_id_only_when_title_missing(self):
        heading = _gold_heading("owner/repo#1", {})
        assert heading == "`owner/repo#1`"


class TestSeededHeading:
    def test_includes_base_source_and_gold_title(self):
        heading = _seeded_heading(
            "seeded::owner/repo#1::rule",
            "owner/repo#1",
            {"owner/repo#1": "Fix the bug"},
        )
        assert "seeded::owner/repo#1::rule" in heading
        assert "owner/repo#1" in heading
        assert "Fix the bug" in heading

    def test_includes_base_source_without_title(self):
        heading = _seeded_heading("seeded::owner/repo#1::rule", "owner/repo#1", {})
        assert "owner/repo#1" in heading

    def test_handles_missing_base_source_gracefully(self):
        heading = _seeded_heading("seeded::x::rule", "", {})
        assert heading == "`seeded::x::rule`"


class TestBuildReportIntegration:
    def _base_kwargs(self, **overrides):
        kwargs = dict(
            scores=make_scores(),
            gold_items=[{"id": "pr1", "repository": "o/r", "title": "Fix the bug"}],
            seeded_items=[],
            commit_hash="abc123",
            model_id="gpt-4o",
            executed_at="2026-01-01T00:00:00Z",
            failed_ids=[],
        )
        kwargs.update(overrides)
        return kwargs

    def test_existing_sections_still_present_unchanged(self):
        report = _build_report(**self._base_kwargs())
        for header in (
            "## 実行情報",
            "## 対象リポジトリ",
            "## 評価対象 PR",
            "## 評価スコア",
            "## Hard Gate 判定",
        ):
            assert header in report

    def test_gold_detail_section_renders_matched_missed_unmatched_rows(self):
        gold_items = [
            make_gold_item_row(
                item_id="pr1",
                matched=[
                    {
                        "expected": make_raw_finding(summary="found by both"),
                        "agent": make_raw_finding(summary="found by both (agent)"),
                        "severity_match": True,
                        "exact_line": True,
                    }
                ],
                missed=[make_raw_finding(path="src/b.ts", summary="only human")],
                unmatched_agent=[
                    make_raw_finding(path="src/c.ts", summary="only agent")
                ],
                expected_total=2,
                agent_total=2,
            )
        ]
        report = _build_report(
            **self._base_kwargs(scores=make_scores(gold_items=gold_items))
        )
        assert "## Gold Set 詳細（PR ごとの人間レビュー指摘 vs Agent 指摘）" in report
        assert "found by both" in report
        assert "only human" in report
        assert "only agent" in report

    def test_report_contains_all_finding_axis_metrics_with_denominators(self):
        report = _build_report(**self._base_kwargs())

        assert "| Severity Exact Agreement | 0.500 (n=2) |" in report
        assert "| Severity Within-One Agreement | 1.000 (n=2) |" in report
        assert "| Impact Exact Agreement | 0.600 (n=5) |" in report
        assert "| Priority Exact Agreement | 0.400 (n=5) |" in report
        assert "| Priority Within-One Agreement | 0.800 (n=5) |" in report

    def test_detail_table_contains_impact_and_priority(self):
        gold_items = [
            make_gold_item_row(
                item_id="pr1",
                missed=[make_raw_finding(impact="performance", priority="medium")],
                expected_total=1,
            )
        ]
        report = _build_report(
            **self._base_kwargs(scores=make_scores(gold_items=gold_items))
        )

        assert "| Impact | Priority |" in report
        assert "performance" in report
        assert "medium" in report

    def test_seeded_detail_has_no_human_review_wording(self):
        seeded_items = [
            make_gold_item_row(
                item_id="seeded::o/r#1::rule",
                missed=[make_raw_finding(summary="injected bug")],
                expected_total=1,
            )
        ]
        report = _build_report(
            **self._base_kwargs(scores=make_scores(seeded_items=seeded_items))
        )
        start = report.index("## Seeded Set 詳細")
        end = report.index("## Hard Gate 判定")
        seeded_section = report[start:end]
        assert "人間レビュー" not in seeded_section

    def test_seeded_detail_uses_must_find_label(self):
        seeded_items = [make_gold_item_row(item_id="seeded::o/r#1::rule")]
        report = _build_report(
            **self._base_kwargs(scores=make_scores(seeded_items=seeded_items))
        )
        assert "Must-Find:" in report

    def test_seeded_detail_cross_references_gold_title_via_base_source(self):
        score_seeded_items = [make_gold_item_row(item_id="seeded::o/r#1::rule")]
        raw_seeded_items = [{"id": "seeded::o/r#1::rule", "base_source": "o/r#1"}]
        report = _build_report(
            **self._base_kwargs(
                gold_items=[
                    {"id": "o/r#1", "repository": "o/r", "title": "Fix the bug"}
                ],
                seeded_items=raw_seeded_items,
                scores=make_scores(seeded_items=score_seeded_items),
            )
        )
        assert "Fix the bug" in report

    def test_empty_items_renders_placeholder_text(self):
        report = _build_report(**self._base_kwargs())
        assert "該当アイテムなし" in report

    def test_failure_section_still_appended_when_failed_ids_present(self):
        report = _build_report(**self._base_kwargs(failed_ids=["pr1"]))
        assert "## 失敗アイテム" in report
        assert "`pr1`" in report

    def test_failed_gold_item_excluded_from_gold_detail_section(self):
        gold_items = [
            make_gold_item_row(
                item_id="pr1",
                missed=[make_raw_finding(summary="should not appear")],
                expected_total=1,
            )
        ]
        report = _build_report(
            **self._base_kwargs(
                scores=make_scores(gold_items=gold_items), failed_ids=["pr1"]
            )
        )
        start = report.index("## Gold Set 詳細")
        end = report.index("## Seeded Set 詳細")
        gold_section = report[start:end]
        assert "should not appear" not in gold_section
        assert "評価失敗のため" in gold_section

    def test_failed_seeded_item_excluded_from_seeded_detail_section(self):
        seeded_items = [
            make_gold_item_row(
                item_id="seeded::o/r#1::rule",
                missed=[make_raw_finding(summary="should not appear")],
                expected_total=1,
            )
        ]
        report = _build_report(
            **self._base_kwargs(
                scores=make_scores(seeded_items=seeded_items),
                failed_ids=["seeded::o/r#1::rule"],
            )
        )
        start = report.index("## Seeded Set 詳細")
        end = report.index("## Hard Gate 判定")
        seeded_section = report[start:end]
        assert "should not appear" not in seeded_section
        assert "評価失敗のため" in seeded_section

    def test_non_failed_items_unaffected_by_unrelated_failed_ids(self):
        gold_items = [
            make_gold_item_row(
                item_id="pr1",
                missed=[make_raw_finding(summary="still shown")],
                expected_total=1,
            )
        ]
        report = _build_report(
            **self._base_kwargs(
                scores=make_scores(gold_items=gold_items), failed_ids=["other-id"]
            )
        )
        assert "still shown" in report
        assert "評価失敗のため" not in report


class TestFailedIdsPath:
    def test_derives_sidecar_path_from_pred_stem(self):
        path = generate_evaluation_report._failed_ids_path(
            "evaluation/data/agent_predictions.jsonl"
        )
        assert str(path) == "evaluation/data/agent_predictions.failed_ids.json"


class TestLoadFailedIds:
    def test_reads_sidecar_next_to_pred_by_default(self, tmp_path):
        pred_path = tmp_path / "agent_predictions.jsonl"
        pred_path.write_text("", encoding="utf-8")
        sidecar = tmp_path / "agent_predictions.failed_ids.json"
        sidecar.write_text('["id-1", "id-2"]', encoding="utf-8")

        failed_ids = generate_evaluation_report._load_failed_ids(str(pred_path), None)

        assert failed_ids == ["id-1", "id-2"]

    def test_explicit_failed_ids_file_overrides_default_sidecar(self, tmp_path):
        pred_path = tmp_path / "agent_predictions.jsonl"
        pred_path.write_text("", encoding="utf-8")
        default_sidecar = tmp_path / "agent_predictions.failed_ids.json"
        default_sidecar.write_text('["should-not-be-used"]', encoding="utf-8")
        explicit = tmp_path / "custom_failed_ids.json"
        explicit.write_text('["id-9"]', encoding="utf-8")

        failed_ids = generate_evaluation_report._load_failed_ids(
            str(pred_path), str(explicit)
        )

        assert failed_ids == ["id-9"]

    def test_missing_sidecar_raises_by_default(self, tmp_path):
        """A missing sidecar must not be silently treated as zero failures:
        merge_predictions.py treats the identical condition as fatal, and a
        deleted/never-written sidecar here would otherwise understate real
        evaluation gaps in the report/notification."""
        pred_path = tmp_path / "agent_predictions.jsonl"
        pred_path.write_text("", encoding="utf-8")

        with pytest.raises(FileNotFoundError):
            generate_evaluation_report._load_failed_ids(str(pred_path), None)

    def test_missing_sidecar_returns_empty_list_with_allow_missing(
        self, tmp_path, capsys
    ):
        pred_path = tmp_path / "agent_predictions.jsonl"
        pred_path.write_text("", encoding="utf-8")

        failed_ids = generate_evaluation_report._load_failed_ids(
            str(pred_path), None, allow_missing=True
        )

        assert failed_ids == []
        assert "WARN" in capsys.readouterr().err
