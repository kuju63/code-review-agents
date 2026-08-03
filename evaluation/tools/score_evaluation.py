#!/usr/bin/env python3
"""Score agent outputs against Gold/Seeded datasets.

Usage:
  python evaluation/tools/score_evaluation.py \
    --gold evaluation/data/gold_pr_set.jsonl \
    --seeded evaluation/data/seeded_set.jsonl \
    --pred evaluation/data/agent_predictions.jsonl
"""

from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, cast

from pydantic import BaseModel
from strands import Agent

from code_review_agent.agents.model_provider_factory import (
    ProviderType,
    create_model_provider,
)
from eval_logging import setup_logging

logger = logging.getLogger(__name__)

SemanticJudge = Callable[[str, str], bool]

_SEMANTIC_JUDGE_SYSTEM_PROMPT = """\
You judge whether two code review findings describe the same underlying \
defect. Both findings already refer to the same file and a nearby line; \
decide whether their content -- not their wording, severity label, or \
category -- points at the same issue.
"""


class SemanticMatchVerdict(BaseModel):
    is_match: bool


def make_llm_semantic_judge(
    model_id: str,
    llm_base_url: str | None = None,
    provider_type: ProviderType = ProviderType.OPENAI,
) -> SemanticJudge:
    """Build a semantic judge backed by an LLM.

    Uses :func:`create_model_provider` -- the same model-selection factory
    used by the review agents (``base_reviewer.py`` / ``lead_engineer.py``):
    a custom ``llm_base_url`` gets a fixed low temperature for
    reproducibility; the default endpoint is used as-is otherwise. This
    judge's own model configuration deliberately stays independent of the
    ``CODE_REVIEW_*``-prefixed settings used by the agents under evaluation,
    to avoid biasing scoring toward whatever model is being graded.

    Returns:
        A callable that takes ``(gold_summary, pred_summary)`` and returns
        ``True`` when the LLM judges them the same underlying defect.
    """
    model = create_model_provider(
        provider_type, model_id, llm_base_url=llm_base_url, temperature=0.0
    )

    agent = Agent(model=model, system_prompt=_SEMANTIC_JUDGE_SYSTEM_PROMPT, tools=[])

    def judge(gold_summary: str, pred_summary: str) -> bool:
        prompt = f"Finding A: {gold_summary}\nFinding B: {pred_summary}"
        try:
            result = agent(prompt, structured_output_model=SemanticMatchVerdict)
        except Exception:
            # Fail closed: --semantic-judge is optional and already
            # non-deterministic, so a transient LLM/transport error should
            # count as a non-match rather than aborting the whole scoring run.
            logger.warning(
                "semantic judge call failed; treating as non-match", exc_info=True
            )
            return False
        if result.structured_output is None:
            return False
        return cast(SemanticMatchVerdict, result.structured_output).is_match

    return judge


def read_jsonl(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
IMPACTS = {"security", "correctness", "performance", "maintainability"}
PRIORITY_RANK = {"low": 0, "medium": 1, "high": 2}


@dataclass(frozen=True)
class Finding:
    category: str
    severity: Any
    impact: Any
    priority: Any
    path: str
    line: int
    summary: str


@dataclass(frozen=True)
class MatchedPair:
    gold: Finding
    pred: Finding
    severity_match: bool
    severity_exact_match: bool | None
    severity_within_one_match: bool | None
    impact_exact_match: bool | None
    priority_exact_match: bool | None
    priority_within_one_match: bool | None
    exact_line: bool


@dataclass(frozen=True)
class MatchResult:
    pairs: list[MatchedPair]
    missed_gold: list[Finding]
    unmatched_pred: list[Finding]


def to_findings(items: list[dict[str, Any]]) -> list[Finding]:
    out: list[Finding] = []
    for i in items:
        out.append(
            Finding(
                category=i.get("category", "unknown"),
                severity=i.get("severity", "unknown"),
                impact=i.get("impact", "unknown"),
                priority=i.get("priority", "unknown"),
                path=i.get("path", ""),
                line=int(i.get("line", 1)),
                summary=i.get("summary", ""),
            )
        )
    return out


def is_match(
    a: Finding,
    b: Finding,
    line_tolerance: int = 5,
    semantic_judge: SemanticJudge | None = None,
) -> bool:
    if a.path != b.path:
        return False
    if abs(a.line - b.line) > line_tolerance:
        return False
    if a.category != "unknown" and b.category != "unknown" and a.category != b.category:
        return False
    if semantic_judge is not None and a.summary and b.summary:
        return semantic_judge(a.summary, b.summary)
    return True


def _exact_match(a: Any, b: Any, choices: set[str]) -> bool | None:
    if not isinstance(a, str) or not isinstance(b, str):
        return None
    if a not in choices or b not in choices:
        return None
    return a == b


def _within_one_match(a: Any, b: Any, ranks: dict[str, int]) -> bool | None:
    if not isinstance(a, str) or not isinstance(b, str):
        return None
    if a not in ranks or b not in ranks:
        return None
    return abs(ranks[a] - ranks[b]) <= 1


def match_findings_detailed(
    gold: list[Finding],
    pred: list[Finding],
    semantic_judge: SemanticJudge | None = None,
) -> MatchResult:
    """Greedily pair each gold finding with an unused pred finding.

    Unlike ``match_findings``, retains the actual matched pairs plus the
    gold findings that were missed and the pred findings that were never
    consumed by any pair -- the detail the greedy loop already computes but
    that a counts-only view throws away.

    Returns:
        A ``MatchResult`` with the matched pairs, missed gold findings,
        and unmatched predicted findings.
    """
    pairs: list[MatchedPair] = []
    missed_gold: list[Finding] = []
    used_pred: set[int] = set()

    for g in gold:
        hit_index = None
        for idx, p in enumerate(pred):
            if idx in used_pred:
                continue
            if is_match(g, p, semantic_judge=semantic_judge):
                hit_index = idx
                break
        if hit_index is None:
            missed_gold.append(g)
            continue
        used_pred.add(hit_index)
        p = pred[hit_index]
        severity_exact_match = _exact_match(g.severity, p.severity, set(SEVERITY_RANK))
        pairs.append(
            MatchedPair(
                gold=g,
                pred=p,
                severity_match=severity_exact_match is True,
                severity_exact_match=severity_exact_match,
                severity_within_one_match=_within_one_match(
                    g.severity, p.severity, SEVERITY_RANK
                ),
                impact_exact_match=_exact_match(g.impact, p.impact, IMPACTS),
                priority_exact_match=_exact_match(
                    g.priority, p.priority, set(PRIORITY_RANK)
                ),
                priority_within_one_match=_within_one_match(
                    g.priority, p.priority, PRIORITY_RANK
                ),
                exact_line=(g.line == p.line),
            )
        )

    unmatched_pred = [p for idx, p in enumerate(pred) if idx not in used_pred]
    return MatchResult(
        pairs=pairs, missed_gold=missed_gold, unmatched_pred=unmatched_pred
    )


def match_findings(
    gold: list[Finding],
    pred: list[Finding],
    semantic_judge: SemanticJudge | None = None,
) -> tuple[int, int, int]:
    """Greedily pair each gold finding with an unused pred finding.

    ``exact_line_matched`` counts matched pairs whose line numbers are
    exactly equal, as opposed to relying on the +/-5 line tolerance -- see
    Location Hit Rate in EVALUATION_PLAN.md Section 3.1.

    Thin counts-only view over ``match_findings_detailed``.

    Returns:
        A ``(matched, severity_matched, exact_line_matched)`` tuple.
    """
    result = match_findings_detailed(gold, pred, semantic_judge=semantic_judge)
    matched = len(result.pairs)
    severity_matched = sum(1 for p in result.pairs if p.severity_match)
    exact_line_matched = sum(1 for p in result.pairs if p.exact_line)
    return matched, severity_matched, exact_line_matched


def safe_div(n: float, d: float) -> float:
    if d == 0:
        return 0.0
    return n / d


def _build_item_detail(
    item_id: str,
    expected: list[Finding],
    raw_expected: list[dict[str, Any]],
    predicted: list[Finding],
    raw_predicted: list[dict[str, Any]],
    result: MatchResult,
) -> dict[str, Any]:
    """Build one entry of score_gold()/score_seeded()'s ``items`` list.

    Keeps the original raw dicts (not a Finding-derived reconstruction) so
    fields ``Finding`` doesn't carry -- Gold's ``source`` (link to the human
    review comment), Seeded's ``rule_id`` -- survive into the report instead
    of being silently dropped. Findings are looked up by ``id()``, not by
    value, because two structurally-equal Finding records can be distinct
    rows (e.g. duplicate findings at the same path/line).

    Returns:
        A dict with the item ``id``, a ``matched`` list pairing each raw
        expected/agent finding with its severity/line-match flags, raw
        ``missed`` and ``unmatched_agent`` finding lists, and the
        ``expected_total``/``agent_total`` counts.
    """
    raw_by_id: dict[int, dict[str, Any]] = {
        id(f): raw for f, raw in zip(expected, raw_expected)
    }
    raw_by_id.update({id(f): raw for f, raw in zip(predicted, raw_predicted)})

    return {
        "id": item_id,
        "matched": [
            {
                "expected": raw_by_id[id(pair.gold)],
                "agent": raw_by_id[id(pair.pred)],
                "severity_match": pair.severity_match,
                "severity_exact_match": pair.severity_exact_match,
                "severity_within_one_match": pair.severity_within_one_match,
                "impact_exact_match": pair.impact_exact_match,
                "priority_exact_match": pair.priority_exact_match,
                "priority_within_one_match": pair.priority_within_one_match,
                "exact_line": pair.exact_line,
            }
            for pair in result.pairs
        ],
        "missed": [raw_by_id[id(f)] for f in result.missed_gold],
        "unmatched_agent": [raw_by_id[id(f)] for f in result.unmatched_pred],
        "expected_total": len(expected),
        "agent_total": len(predicted),
    }


def score_gold(
    gold_rows: list[dict[str, Any]],
    pred_by_id: dict[str, dict[str, Any]],
    semantic_judge: SemanticJudge | None = None,
) -> dict[str, Any]:
    gold_total = 0
    gold_matched = 0
    pred_total_for_gold = 0
    exact_line_matched_total = 0
    severity_labeled = 0
    severity_exact = 0
    severity_within_one = 0
    impact_labeled = 0
    impact_exact = 0
    priority_labeled = 0
    priority_exact = 0
    priority_within_one = 0
    items: list[dict[str, Any]] = []

    for row in gold_rows:
        pred = pred_by_id.get(row["id"], {"agent_findings": []})
        raw_expected = row.get("human_findings", [])
        raw_predicted = pred.get("agent_findings", [])
        gold_findings = to_findings(raw_expected)
        pred_findings = to_findings(raw_predicted)

        result = match_findings_detailed(
            gold_findings, pred_findings, semantic_judge=semantic_judge
        )
        matched = len(result.pairs)
        exact_line_matched = sum(1 for p in result.pairs if p.exact_line)

        gold_total += len(gold_findings)
        gold_matched += matched
        pred_total_for_gold += len(pred_findings)
        severity_labeled += sum(
            1 for pair in result.pairs if pair.severity_exact_match is not None
        )
        severity_exact += sum(
            1 for pair in result.pairs if pair.severity_exact_match is True
        )
        severity_within_one += sum(
            1 for pair in result.pairs if pair.severity_within_one_match is True
        )
        impact_labeled += sum(
            1 for pair in result.pairs if pair.impact_exact_match is not None
        )
        impact_exact += sum(
            1 for pair in result.pairs if pair.impact_exact_match is True
        )
        priority_labeled += sum(
            1 for pair in result.pairs if pair.priority_exact_match is not None
        )
        priority_exact += sum(
            1 for pair in result.pairs if pair.priority_exact_match is True
        )
        priority_within_one += sum(
            1 for pair in result.pairs if pair.priority_within_one_match is True
        )
        exact_line_matched_total += exact_line_matched
        items.append(
            _build_item_detail(
                row["id"],
                gold_findings,
                raw_expected,
                pred_findings,
                raw_predicted,
                result,
            )
        )

    return {
        "issue_recall": safe_div(gold_matched, gold_total),
        "issue_precision": safe_div(gold_matched, pred_total_for_gold),
        "severity_agreement": safe_div(severity_exact, severity_labeled),
        "severity_exact_agreement": safe_div(severity_exact, severity_labeled),
        "severity_within_one_agreement": safe_div(
            severity_within_one, severity_labeled
        ),
        "impact_exact_agreement": safe_div(impact_exact, impact_labeled),
        "priority_exact_agreement": safe_div(priority_exact, priority_labeled),
        "priority_within_one_agreement": safe_div(
            priority_within_one, priority_labeled
        ),
        "location_hit_rate": safe_div(exact_line_matched_total, gold_matched),
        "counts": {
            "gold_total": gold_total,
            "gold_matched": gold_matched,
            "pred_total_for_gold": pred_total_for_gold,
            "location_matched_exact": exact_line_matched_total,
            "severity_labeled_pairs": severity_labeled,
            "severity_exact_matched": severity_exact,
            "severity_within_one_matched": severity_within_one,
            "impact_labeled_pairs": impact_labeled,
            "impact_exact_matched": impact_exact,
            "priority_labeled_pairs": priority_labeled,
            "priority_exact_matched": priority_exact,
            "priority_within_one_matched": priority_within_one,
        },
        "items": items,
    }


def score_seeded(
    seeded_rows: list[dict[str, Any]],
    pred_by_id: dict[str, dict[str, Any]],
    semantic_judge: SemanticJudge | None = None,
) -> dict[str, Any]:
    seeded_total = 0
    seeded_detected = 0
    seeded_critical_total = 0
    seeded_critical_missed = 0
    items: list[dict[str, Any]] = []

    for row in seeded_rows:
        pred = pred_by_id.get(row["id"], {"agent_findings": []})
        raw_expected = row.get("must_find", [])
        raw_predicted = pred.get("agent_findings", [])
        must_find = to_findings(raw_expected)
        pred_findings = to_findings(raw_predicted)
        result = match_findings_detailed(
            must_find, pred_findings, semantic_judge=semantic_judge
        )
        seeded_total += len(must_find)
        seeded_detected += len(result.pairs)
        items.append(
            _build_item_detail(
                row["id"], must_find, raw_expected, pred_findings, raw_predicted, result
            )
        )

        # Deliberately independent of the greedy pairing above: a critical
        # must_find item counts as "missed" only if it structurally matches
        # nothing in the full pred pool, regardless of pairing/consumption
        # order. This keeps critical_miss_rate (a Hard Gate metric) from
        # drifting due to the greedy matcher's item-processing order.
        for mf in must_find:
            if mf.severity == "critical":
                seeded_critical_total += 1
                if not any(
                    is_match(mf, p, semantic_judge=semantic_judge)
                    for p in pred_findings
                ):
                    seeded_critical_missed += 1

    return {
        "must_find_recall": safe_div(seeded_detected, seeded_total),
        "critical_miss_rate": safe_div(seeded_critical_missed, seeded_critical_total),
        "counts": {
            "seeded_total": seeded_total,
            "seeded_detected": seeded_detected,
            "seeded_critical_total": seeded_critical_total,
            "seeded_critical_missed": seeded_critical_missed,
        },
        "items": items,
    }


def main() -> int:
    setup_logging()
    parser = argparse.ArgumentParser(description="Score review agent evaluation")
    parser.add_argument("--gold", required=True)
    parser.add_argument("--seeded", required=True)
    parser.add_argument(
        "--pred", required=True, help="Predictions JSONL with id + agent_findings"
    )
    parser.add_argument(
        "--semantic-judge",
        action="store_true",
        help=(
            "Enable LLM-as-judge semantic matching of finding summaries on top "
            "of the path/line/category rule. Off by default: it adds API "
            "calls and non-determinism, which would make the Seeded-set hard "
            "release gates (EVALUATION_PLAN.md Section 4) flaky."
        ),
    )
    parser.add_argument(
        "--model-id",
        default="gpt-4o",
        help="OpenAI-compatible model id used when --semantic-judge is set",
    )
    parser.add_argument(
        "--llm-base-url",
        default=None,
        help="Optional OpenAI-compatible base URL used when --semantic-judge is set",
    )
    parser.add_argument(
        "--provider-type",
        default=ProviderType.OPENAI.value,
        choices=[p.value for p in ProviderType],
        help="Backend for --semantic-judge (openai or ollama)",
    )
    args = parser.parse_args()

    gold_rows = read_jsonl(args.gold)
    seeded_rows = read_jsonl(args.seeded)
    pred_rows = read_jsonl(args.pred)

    pred_by_id = {row["id"]: row for row in pred_rows}

    semantic_judge = (
        make_llm_semantic_judge(
            args.model_id, args.llm_base_url, ProviderType(args.provider_type)
        )
        if args.semantic_judge
        else None
    )

    report = {
        "gold": score_gold(gold_rows, pred_by_id, semantic_judge=semantic_judge),
        "seeded": score_seeded(seeded_rows, pred_by_id, semantic_judge=semantic_judge),
    }

    # stdout is generate_evaluation_report.py's machine-readable contract
    # (json.loads(result.stdout)) -- keep this on print, not logging.
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
