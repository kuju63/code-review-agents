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
from strands.models.openai import OpenAIModel

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
    model_id: str, llm_base_url: str | None = None
) -> SemanticJudge:
    """Build a semantic judge backed by an OpenAI-compatible LLM.

    Mirrors the model-selection pattern used by the review agents
    (``base_reviewer.py`` / ``lead_engineer.py``): a custom ``llm_base_url``
    gets a fixed low temperature for reproducibility; the default endpoint is
    used as-is otherwise.

    Returns:
        A callable that takes ``(gold_summary, pred_summary)`` and returns
        ``True`` when the LLM judges them the same underlying defect.
    """
    if llm_base_url:
        model = OpenAIModel(
            model_id=model_id,
            client_args={"base_url": llm_base_url},
            params={"temperature": 0.0},
        )
    else:
        model = OpenAIModel(model_id=model_id)

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


@dataclass(frozen=True)
class Finding:
    category: str
    severity: str
    path: str
    line: int
    summary: str


@dataclass(frozen=True)
class MatchedPair:
    gold: Finding
    pred: Finding
    severity_match: bool
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
        pairs.append(
            MatchedPair(
                gold=g,
                pred=p,
                severity_match=(
                    g.severity != "unknown"
                    and p.severity != "unknown"
                    and g.severity == p.severity
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
    severity_total = 0
    severity_matched = 0
    exact_line_matched_total = 0
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
        sev_matched = sum(1 for p in result.pairs if p.severity_match)
        exact_line_matched = sum(1 for p in result.pairs if p.exact_line)

        gold_total += len(gold_findings)
        gold_matched += matched
        pred_total_for_gold += len(pred_findings)
        severity_total += matched
        severity_matched += sev_matched
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
        "severity_agreement": safe_div(severity_matched, severity_total),
        "location_hit_rate": safe_div(exact_line_matched_total, gold_matched),
        "counts": {
            "gold_total": gold_total,
            "gold_matched": gold_matched,
            "pred_total_for_gold": pred_total_for_gold,
            "location_matched_exact": exact_line_matched_total,
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
    args = parser.parse_args()

    gold_rows = read_jsonl(args.gold)
    seeded_rows = read_jsonl(args.seeded)
    pred_rows = read_jsonl(args.pred)

    pred_by_id = {row["id"]: row for row in pred_rows}

    semantic_judge = (
        make_llm_semantic_judge(args.model_id, args.llm_base_url)
        if args.semantic_judge
        else None
    )

    report = {
        "gold": score_gold(gold_rows, pred_by_id, semantic_judge=semantic_judge),
        "seeded": score_seeded(seeded_rows, pred_by_id, semantic_judge=semantic_judge),
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
