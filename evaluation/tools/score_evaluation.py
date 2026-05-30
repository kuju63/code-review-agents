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
from dataclasses import dataclass
from typing import Any


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


def is_match(a: Finding, b: Finding, line_tolerance: int = 5) -> bool:
    if a.path != b.path:
        return False
    if abs(a.line - b.line) > line_tolerance:
        return False
    if a.category != "unknown" and b.category != "unknown" and a.category != b.category:
        return False
    return True


def match_findings(gold: list[Finding], pred: list[Finding]) -> tuple[int, int]:
    matched = 0
    severity_matched = 0
    used_pred: set[int] = set()

    for g in gold:
        hit_index = None
        for idx, p in enumerate(pred):
            if idx in used_pred:
                continue
            if is_match(g, p):
                hit_index = idx
                break
        if hit_index is None:
            continue
        matched += 1
        used_pred.add(hit_index)
        p = pred[hit_index]
        if g.severity != "unknown" and p.severity != "unknown" and g.severity == p.severity:
            severity_matched += 1

    return matched, severity_matched


def safe_div(n: float, d: float) -> float:
    if d == 0:
        return 0.0
    return n / d


def main() -> int:
    parser = argparse.ArgumentParser(description="Score review agent evaluation")
    parser.add_argument("--gold", required=True)
    parser.add_argument("--seeded", required=True)
    parser.add_argument("--pred", required=True, help="Predictions JSONL with id + agent_findings")
    args = parser.parse_args()

    gold_rows = read_jsonl(args.gold)
    seeded_rows = read_jsonl(args.seeded)
    pred_rows = read_jsonl(args.pred)

    pred_by_id = {row["id"]: row for row in pred_rows}

    gold_total = 0
    gold_matched = 0
    pred_total_for_gold = 0
    severity_total = 0
    severity_matched = 0

    for row in gold_rows:
        pred = pred_by_id.get(row["id"], {"agent_findings": []})
        gold_findings = to_findings(row.get("human_findings", []))
        pred_findings = to_findings(pred.get("agent_findings", []))

        matched, sev_matched = match_findings(gold_findings, pred_findings)
        gold_total += len(gold_findings)
        gold_matched += matched
        pred_total_for_gold += len(pred_findings)
        severity_total += matched
        severity_matched += sev_matched

    seeded_total = 0
    seeded_detected = 0
    seeded_critical_total = 0
    seeded_critical_missed = 0

    for row in seeded_rows:
        pred = pred_by_id.get(row["id"], {"agent_findings": []})
        must_find = to_findings(row.get("must_find", []))
        pred_findings = to_findings(pred.get("agent_findings", []))
        detected, _ = match_findings(must_find, pred_findings)
        seeded_total += len(must_find)
        seeded_detected += detected

        for mf in must_find:
            if mf.severity == "critical":
                seeded_critical_total += 1
                if not any(is_match(mf, p) for p in pred_findings):
                    seeded_critical_missed += 1

    report = {
        "gold": {
            "issue_recall": safe_div(gold_matched, gold_total),
            "issue_precision": safe_div(gold_matched, pred_total_for_gold),
            "severity_agreement": safe_div(severity_matched, severity_total),
            "counts": {
                "gold_total": gold_total,
                "gold_matched": gold_matched,
                "pred_total_for_gold": pred_total_for_gold,
            },
        },
        "seeded": {
            "must_find_recall": safe_div(seeded_detected, seeded_total),
            "critical_miss_rate": safe_div(seeded_critical_missed, seeded_critical_total),
            "counts": {
                "seeded_total": seeded_total,
                "seeded_detected": seeded_detected,
                "seeded_critical_total": seeded_critical_total,
                "seeded_critical_missed": seeded_critical_missed,
            },
        },
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
