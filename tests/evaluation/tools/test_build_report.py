"""Tests for evaluation/tools/run_agent_evaluation.py::_build_report.

Covers the per-item detail rendering added on top of the existing
aggregate-only report: Gold PR sections showing human_findings vs
agent_findings (matched/missed/unmatched), Seeded item sections showing
must_find vs agent_findings with no "human review" wording, and the
_sanitize_cell/_ref_cell table-cell helpers.
"""

from __future__ import annotations

from tests.evaluation.conftest import load_eval_tool_module

run_agent_evaluation = load_eval_tool_module(
    "run_agent_evaluation", "run_agent_evaluation.py"
)

_build_report = run_agent_evaluation._build_report
_sanitize_cell = run_agent_evaluation._sanitize_cell
_ref_cell = run_agent_evaluation._ref_cell
_render_item_detail = run_agent_evaluation._render_item_detail
_gold_heading = run_agent_evaluation._gold_heading
_seeded_heading = run_agent_evaluation._seeded_heading


def make_scores(
    gold_items=None, seeded_items=None, gold_counts=None, seeded_counts=None
):
    return {
        "gold": {
            "issue_recall": 0.5,
            "issue_precision": 0.5,
            "severity_agreement": 0.5,
            "location_hit_rate": 0.5,
            "counts": gold_counts
            or {
                "gold_total": 1,
                "gold_matched": 1,
                "pred_total_for_gold": 1,
                "location_matched_exact": 1,
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
    path="src/a.ts",
    line=10,
    category="security",
    severity="high",
    summary="xss via innerHTML",
    **extra,
):
    return {
        "path": path,
        "line": line,
        "category": category,
        "severity": severity,
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
