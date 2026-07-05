"""Tests for evaluation/tools/score_evaluation.py.

Covers: is_match's structural rules (path/line tolerance/category) plus the
optional LLM-as-judge semantic gate, match_findings' greedy one-to-one
pairing and its Location Hit Rate tracking (see EVALUATION_PLAN.md §3.1), and
the score_gold/score_seeded report builders extracted from main() so they can
be exercised without argparse/file I/O.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from tests.evaluation.conftest import load_eval_tool_module

score_evaluation = load_eval_tool_module("score_evaluation", "score_evaluation.py")

Finding = score_evaluation.Finding
is_match = score_evaluation.is_match
match_findings = score_evaluation.match_findings
score_gold = score_evaluation.score_gold
score_seeded = score_evaluation.score_seeded
make_llm_semantic_judge = score_evaluation.make_llm_semantic_judge
SemanticMatchVerdict = score_evaluation.SemanticMatchVerdict


def make_finding(
    path="src/a.ts",
    line=10,
    category="security",
    severity="high",
    summary="xss via innerHTML",
):
    return Finding(
        category=category, severity=severity, path=path, line=line, summary=summary
    )


class TestIsMatchStructuralRules:
    def test_rejects_different_path(self):
        a = make_finding(path="src/a.ts")
        b = make_finding(path="src/b.ts")
        assert is_match(a, b) is False

    def test_accepts_line_within_tolerance_above(self):
        a = make_finding(line=10)
        b = make_finding(line=15)
        assert is_match(a, b) is True

    def test_rejects_line_outside_tolerance_above(self):
        a = make_finding(line=10)
        b = make_finding(line=16)
        assert is_match(a, b) is False

    def test_accepts_line_within_tolerance_below(self):
        a = make_finding(line=10)
        b = make_finding(line=5)
        assert is_match(a, b) is True

    def test_rejects_line_outside_tolerance_below(self):
        a = make_finding(line=10)
        b = make_finding(line=4)
        assert is_match(a, b) is False

    def test_rejects_category_mismatch_when_both_known(self):
        a = make_finding(category="security")
        b = make_finding(category="performance")
        assert is_match(a, b) is False

    def test_unknown_category_short_circuits_category_check(self):
        a = make_finding(category="unknown")
        b = make_finding(category="performance")
        assert is_match(a, b) is True


class TestIsMatchSemanticJudge:
    def test_semantic_judge_can_reject_structurally_matching_pair(self):
        a = make_finding(summary="missing null check")
        b = make_finding(summary="inefficient loop")
        judge = MagicMock(return_value=False)
        assert is_match(a, b, semantic_judge=judge) is False
        judge.assert_called_once_with(a.summary, b.summary)

    def test_semantic_judge_can_accept_pair(self):
        a = make_finding(summary="missing null check")
        b = make_finding(summary="npe risk on unchecked value")
        judge = MagicMock(return_value=True)
        assert is_match(a, b, semantic_judge=judge) is True

    def test_semantic_judge_skipped_when_a_summary_empty(self):
        a = make_finding(summary="")
        b = make_finding(summary="some comment")
        judge = MagicMock(return_value=False)
        assert is_match(a, b, semantic_judge=judge) is True
        judge.assert_not_called()

    def test_semantic_judge_skipped_when_b_summary_empty(self):
        a = make_finding(summary="some comment")
        b = make_finding(summary="")
        judge = MagicMock(return_value=False)
        assert is_match(a, b, semantic_judge=judge) is True
        judge.assert_not_called()


class TestMatchFindings:
    def test_counts_matched_severity_and_exact_line(self):
        gold = [make_finding(line=10, severity="high")]
        pred = [make_finding(line=10, severity="high")]
        matched, severity_matched, exact_line_matched = match_findings(gold, pred)
        assert (matched, severity_matched, exact_line_matched) == (1, 1, 1)

    def test_tolerance_window_match_is_not_counted_as_exact_line(self):
        gold = [make_finding(line=10)]
        pred = [make_finding(line=13)]
        matched, _, exact_line_matched = match_findings(gold, pred)
        assert matched == 1
        assert exact_line_matched == 0

    def test_greedy_matching_consumes_each_pred_once(self):
        gold = [make_finding(line=10), make_finding(line=11)]
        pred = [make_finding(line=10)]
        matched, _, _ = match_findings(gold, pred)
        assert matched == 1

    def test_severity_unknown_is_excluded_from_severity_matched(self):
        gold = [make_finding(severity="unknown")]
        pred = [make_finding(severity="unknown")]
        matched, severity_matched, _ = match_findings(gold, pred)
        assert matched == 1
        assert severity_matched == 0


class TestScoreGoldLocationHitRate:
    def test_all_exact_line_matches_yield_full_rate(self):
        gold_rows = [
            {
                "id": "pr1",
                "human_findings": [make_finding(line=10).__dict__],
            }
        ]
        pred_by_id = {"pr1": {"agent_findings": [make_finding(line=10).__dict__]}}
        report = score_gold(gold_rows, pred_by_id)
        assert report["location_hit_rate"] == 1.0
        assert report["counts"]["location_matched_exact"] == 1

    def test_tolerance_only_match_yields_zero_rate(self):
        gold_rows = [{"id": "pr1", "human_findings": [make_finding(line=10).__dict__]}]
        pred_by_id = {"pr1": {"agent_findings": [make_finding(line=13).__dict__]}}
        report = score_gold(gold_rows, pred_by_id)
        assert report["counts"]["gold_matched"] == 1
        assert report["location_hit_rate"] == 0.0

    def test_mixed_exact_and_tolerance_matches_yield_partial_rate(self):
        gold_rows = [
            {
                "id": "pr1",
                "human_findings": [
                    make_finding(path="src/a.ts", line=10).__dict__,
                    make_finding(path="src/b.ts", line=20).__dict__,
                ],
            }
        ]
        pred_by_id = {
            "pr1": {
                "agent_findings": [
                    make_finding(path="src/a.ts", line=10).__dict__,
                    make_finding(path="src/b.ts", line=23).__dict__,
                ]
            }
        }
        report = score_gold(gold_rows, pred_by_id)
        assert report["counts"]["gold_matched"] == 2
        assert report["location_hit_rate"] == 0.5

    def test_no_matches_does_not_divide_by_zero(self):
        gold_rows = [
            {"id": "pr1", "human_findings": [make_finding(path="src/a.ts").__dict__]}
        ]
        pred_by_id = {
            "pr1": {"agent_findings": [make_finding(path="src/other.ts").__dict__]}
        }
        report = score_gold(gold_rows, pred_by_id)
        assert report["counts"]["gold_matched"] == 0
        assert report["location_hit_rate"] == 0.0


class TestScoreSeeded:
    def test_must_find_recall_and_critical_miss_rate(self):
        seeded_rows = [
            {
                "id": "seed1",
                "must_find": [
                    make_finding(path="src/a.ts", line=5, severity="critical").__dict__,
                    make_finding(path="src/b.ts", line=15, severity="medium").__dict__,
                ],
            }
        ]
        pred_by_id = {
            "seed1": {
                "agent_findings": [
                    make_finding(path="src/a.ts", line=5, severity="critical").__dict__
                ]
            }
        }
        report = score_seeded(seeded_rows, pred_by_id)
        assert report["must_find_recall"] == 0.5
        assert report["critical_miss_rate"] == 0.0
        assert report["counts"]["seeded_critical_total"] == 1
        assert report["counts"]["seeded_critical_missed"] == 0


class TestMakeLlmSemanticJudge:
    def test_judge_calls_agent_and_returns_parsed_verdict(self):
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = SemanticMatchVerdict(is_match=True)
        with (
            patch.object(score_evaluation, "Agent", return_value=mock_agent),
            patch.object(score_evaluation, "OpenAIModel"),
        ):
            judge = make_llm_semantic_judge("gpt-4o")
            result = judge("missing null check", "npe risk on unchecked value")
        assert result is True
        _, kwargs = mock_agent.call_args
        assert kwargs["structured_output_model"] is SemanticMatchVerdict

    def test_judge_returns_false_when_structured_output_missing(self):
        mock_agent = MagicMock()
        mock_agent.return_value.structured_output = None
        with (
            patch.object(score_evaluation, "Agent", return_value=mock_agent),
            patch.object(score_evaluation, "OpenAIModel"),
        ):
            judge = make_llm_semantic_judge("gpt-4o")
            result = judge("a", "b")
        assert result is False

    def test_judge_fails_closed_on_transient_agent_error(self):
        mock_agent = MagicMock(side_effect=TimeoutError("upstream timed out"))
        with (
            patch.object(score_evaluation, "Agent", return_value=mock_agent),
            patch.object(score_evaluation, "OpenAIModel"),
        ):
            judge = make_llm_semantic_judge("gpt-4o")
            result = judge("a", "b")
        assert result is False
