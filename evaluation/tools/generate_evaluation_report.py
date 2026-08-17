#!/usr/bin/env python3
"""Score predictions and generate the Markdown evaluation report + Discord notification.

Usage:
  python evaluation/tools/generate_evaluation_report.py \
    --gold evaluation/data/gold_pr_set.jsonl \
    --seeded evaluation/data/seeded_set.jsonl \
    --pred evaluation/data/agent_predictions.jsonl

Split out of run_agent_evaluation.py so the (fast) scoring/report/notification
step can run independently of the (slow) A2A evaluation step -- see
docs/eval-sharded-execution-spec.md. run_agent_evaluation.py invokes this
script as a subprocess after a non-sharded run, exactly as it already does
for score_evaluation.py; after a sharded run + merge_predictions.py, invoke
this script directly.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from discord_notify import build_notification_payload, send_discord_notification
from eval_logging import setup_logging

logger = logging.getLogger(__name__)


def read_jsonl(path: str) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _get_commit_hash() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


def _failed_ids_path(pred_path: str) -> Path:
    """Sidecar path recording ids that raised during evaluation.

    Naming convention shared with run_agent_evaluation.py and
    merge_predictions.py: ``agent_predictions.jsonl`` ->
    ``agent_predictions.failed_ids.json``.

    Returns:
        The sidecar path derived from *pred_path*.
    """
    p = Path(pred_path)
    return p.with_name(p.stem + ".failed_ids.json")


def _load_failed_ids(
    pred_path: str, failed_ids_file: str | None, allow_missing: bool = False
) -> list[str]:
    """Load the failed-ids list for *pred_path*.

    In the intended pipeline (run_agent_evaluation.py always writes this
    sidecar, and merge_predictions.py enforces its presence before writing
    a merged one) the sidecar always exists, so a missing one is fatal by
    default -- mirroring merge_predictions.py's own default-strict
    treatment of the same condition -- rather than silently reporting zero
    failures. Pass *allow_missing* to accept a hand-assembled predictions
    file that genuinely has no sidecar.

    Returns:
        The failed-ids list read from *failed_ids_file* (or the default
        sidecar next to *pred_path*), or an empty list with a stderr
        warning when *allow_missing* is set and no sidecar is found.

    Raises:
        FileNotFoundError: If no sidecar is found and *allow_missing* is
            ``False``.
    """
    path = Path(failed_ids_file) if failed_ids_file else _failed_ids_path(pred_path)
    if not path.exists():
        if not allow_missing:
            raise FileNotFoundError(
                f"No failed_ids sidecar found at {path}. Every predictions file "
                "produced by run_agent_evaluation.py or merge_predictions.py has "
                "one; its absence usually means failures are being silently "
                "undercounted. Pass --allow-missing-failed-ids to proceed anyway "
                "(assumes zero failures)."
            )
        logger.warning(
            "No failed_ids sidecar found at %s; assuming zero failures "
            "(--allow-missing-failed-ids was set). Failure counts in the "
            "report/notification may be inaccurate.",
            path,
        )
        return []
    return json.loads(path.read_text(encoding="utf-8"))


_SCORE_TIMEOUT_SECONDS = 1800


def _score(gold_path: str, seeded_path: str, pred_path: str) -> dict[str, Any]:
    """Run the TypeScript scorer CLI and return the parsed JSON result.

    The scorer was migrated to TypeScript (Issue #254). Only stdout is
    piped (the scorer's machine-readable JSON contract); stderr is left to
    inherit so the scorer's own log records stream straight to this
    process's console instead of being captured and discarded.

    Returns:
        The parsed JSON object printed by the scorer on stdout.

    Raises:
        RuntimeError: If the scorer exits with a non-zero status, is not
            found on PATH, times out, or does not emit valid JSON.
    """
    repo_root = Path(__file__).resolve().parents[2]
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError(
            "score-evaluation could not start: 'pnpm' was not found on PATH; "
            "run this step inside the repository Nix toolchain "
            "(nix develop --command ...)"
        )
    try:
        result = subprocess.run(  # noqa: S603 - fixed argv list and no shell execution
            [
                pnpm,
                "--silent",
                "--filter",
                "@code-review-agent/evaluation",
                "run",
                "score-evaluation",
                "--gold",
                gold_path,
                "--seeded",
                seeded_path,
                "--pred",
                pred_path,
            ],
            stdout=subprocess.PIPE,
            text=True,
            cwd=repo_root,
            timeout=_SCORE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"score-evaluation timed out after {_SCORE_TIMEOUT_SECONDS}s"
        ) from exc
    if result.returncode != 0:
        raise RuntimeError(
            f"score-evaluation failed (exit code {result.returncode}); "
            "see its stderr output above"
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            "score-evaluation emitted invalid JSON; "
            f"stdout starts with {result.stdout[:200]!r}"
        ) from exc


def _sanitize_cell(text: Any, max_len: int = 100) -> str:
    """Make *text* safe for one Markdown table cell.

    A raw newline breaks a table row and a literal ``|`` is parsed as a new
    column, so both are neutralized; long text is truncated with an
    ellipsis, generalizing the existing ``title[:50]`` truncation pattern.

    *text* is coerced via ``str()`` (``None`` becomes ``""``) because
    call sites read straight from dataset/prediction rows loaded from JSONL
    with no runtime schema enforcement -- a malformed or hand-edited row
    (e.g. ``"summary": null``) must not crash report generation.

    Returns:
        The whitespace-collapsed, pipe-escaped, length-clamped text.
    """
    collapsed = " ".join(str(text if text is not None else "").split())
    escaped = collapsed.replace("|", "\\|")
    if len(escaped) > max_len:
        return escaped[: max_len - 1] + "…"
    return escaped


def _ref_cell(raw: dict[str, Any]) -> str:
    """Traceability link for one finding: Gold's review-comment ``source``
    URL, or Seeded's ``rule_id``, or ``-`` when neither is present. Lets
    Gold/Seeded items share one render path with no dataset-specific branch.

    Returns:
        A Markdown link/code span for the finding's traceability
        reference, or ``"-"`` when neither ``source`` nor ``rule_id`` is
        present.
    """
    if raw.get("source"):
        return f"[source]({raw['source']})"
    if raw.get("rule_id"):
        return f"`{raw['rule_id']}`"
    return "-"


def _finding_row(kind: str, raw: dict[str, Any]) -> str:
    path = _sanitize_cell(raw.get("path", ""))
    line = _sanitize_cell(raw.get("line", ""))
    category = _sanitize_cell(raw.get("category", "unknown"))
    severity = _sanitize_cell(raw.get("severity", "unknown"))
    impact = _sanitize_cell(raw.get("impact", "unknown"))
    priority = _sanitize_cell(raw.get("priority", "unknown"))
    summary = _sanitize_cell(raw.get("summary", ""))
    ref = _sanitize_cell(_ref_cell(raw))
    return (
        f"| {kind} | `{path}:{line}` | {category} | {severity} | {impact} | "
        f"{priority} | {summary} | {ref} |"
    )


def _render_item_detail(item: dict[str, Any], heading: str, expected_label: str) -> str:
    """Render one Gold PR or Seeded item's matched/missed/unmatched-agent detail.

    Returns:
        A Markdown section (``heading`` + summary line + findings table)
        for this item.
    """
    rows = []
    for m in item["matched"]:
        rows.append(_finding_row("✅ マッチ", m["expected"]))
    for f in item["missed"]:
        rows.append(_finding_row("❌ 見逃し", f))
    for f in item["unmatched_agent"]:
        rows.append(_finding_row("➕ Agentのみ（誤検知とは限らない）", f))

    body = (
        "| 種別 | Path:Line | Category | Severity | Impact | Priority | Summary | Ref |\n"
        "|---|---|---|---|---|---|---|---|\n" + "\n".join(rows)
        if rows
        else "_findings なし_"
    )
    n_expected = item["expected_total"]
    n_matched = len(item["matched"])
    n_missed = len(item["missed"])
    n_unmatched = len(item["unmatched_agent"])

    return (
        f"### {heading}\n\n{body}\n\n"
        f"- {expected_label}: {n_expected} 件 / マッチ: {n_matched} 件 / "
        f"見逃し: {n_missed} 件 / Agentのみ: {n_unmatched} 件\n"
    )


def _gold_heading(item_id: str, gold_title_by_id: dict[str, str]) -> str:
    title = gold_title_by_id.get(item_id, "")
    return f"`{item_id}` — {title[:50]}" if title else f"`{item_id}`"


def _seeded_heading(
    item_id: str, base_source: str, gold_title_by_id: dict[str, str]
) -> str:
    title = gold_title_by_id.get(base_source, "")
    if base_source and title:
        return f"`{item_id}`（元PR: `{base_source}` {title[:50]}）"
    if base_source:
        return f"`{item_id}`（元PR: `{base_source}`）"
    return f"`{item_id}`"


def _build_report(
    scores: dict[str, Any],
    gold_items: list[dict[str, Any]],
    seeded_items: list[dict[str, Any]],
    commit_hash: str,
    model_id: str,
    executed_at: str,
    failed_ids: list[str],
) -> str:
    g = scores["gold"]
    s = scores["seeded"]

    critical_miss_ok = s["critical_miss_rate"] == 0.0
    must_find_ok = s["must_find_recall"] >= 0.95
    hard_gate = "PASS ✅" if (critical_miss_ok and must_find_ok) else "FAIL ❌"

    repos = sorted({item["repository"] for item in gold_items})
    repo_list = "\n".join(f"- `{r}`" for r in repos)

    pr_lines = []
    for item in gold_items:
        nf = len(item.get("human_findings", []))
        pr_lines.append(f"| `{item['id']}` | {item['title'][:50]} | {nf} |")

    pr_table = "\n".join(pr_lines)

    gold_title_by_id = {item["id"]: item.get("title", "") for item in gold_items}
    seeded_base_source_by_id = {
        item["id"]: item.get("base_source", "") for item in seeded_items
    }

    # Items in failed_ids have no real prediction (score_gold/score_seeded
    # default them to "0 agent findings"), so their detail would render as
    # 100% missed / all-agent-only -- indistinguishable from an agent that
    # genuinely found nothing, when the truth is "evaluation errored out
    # before producing a prediction". Excluding them here keeps the new
    # drill-down consistent with the existing 失敗アイテム/partial-score
    # disclosure instead of contradicting it.
    failed_id_set = set(failed_ids)
    gold_detail_items = [item for item in g["items"] if item["id"] not in failed_id_set]
    seeded_detail_items = [
        item for item in s["items"] if item["id"] not in failed_id_set
    ]

    gold_excluded_note = (
        f"_評価失敗のため {len(g['items']) - len(gold_detail_items)} 件を除外"
        "（詳細は「失敗アイテム」を参照）_\n\n"
        if len(gold_detail_items) != len(g["items"])
        else ""
    )
    seeded_excluded_note = (
        f"_評価失敗のため {len(s['items']) - len(seeded_detail_items)} 件を除外"
        "（詳細は「失敗アイテム」を参照）_\n\n"
        if len(seeded_detail_items) != len(s["items"])
        else ""
    )

    gold_detail = gold_excluded_note + (
        "\n".join(
            _render_item_detail(
                item, _gold_heading(item["id"], gold_title_by_id), "人間レビュー指摘"
            )
            for item in gold_detail_items
        )
        or "_(該当PRなし)_\n"
    )

    seeded_detail = seeded_excluded_note + (
        "\n".join(
            _render_item_detail(
                item,
                _seeded_heading(
                    item["id"],
                    seeded_base_source_by_id.get(item["id"], ""),
                    gold_title_by_id,
                ),
                "Must-Find",
            )
            for item in seeded_detail_items
        )
        or "_(該当アイテムなし)_\n"
    )

    failure_section = ""
    if failed_ids:
        ids = "\n".join(f"- `{i}`" for i in failed_ids)
        failure_section = f"\n## 失敗アイテム\n\n以下のアイテムはエラーにより評価できませんでした（スコアは部分結果）:\n\n{ids}\n"

    return f"""# Agent 性能評価レポート: React + MUI

## 実行情報

| 項目 | 値 |
|---|---|
| 実行日時 | {executed_at} |
| Commit hash | `{commit_hash}` |
| モデル | `{model_id}` |

## 対象リポジトリ

{repo_list}

## 評価対象 PR

| ID | タイトル | human findings |
|---|---|---|
{pr_table}

## 評価スコア

### Gold set（実PRとの比較）

| 指標 | 値 | 目標 |
|---|---|---|
| Issue Recall | {g["issue_recall"]:.3f} | ≥ 0.70 |
| Issue Precision | {g["issue_precision"]:.3f} | ≥ 0.60 |
| Severity Agreement | {g["severity_agreement"]:.3f} | ≥ 0.70 |
| Severity Exact Agreement | {g["severity_exact_agreement"]:.3f} (n={g["counts"]["severity_labeled_pairs"]}) | - |
| Severity Within-One Agreement | {g["severity_within_one_agreement"]:.3f} (n={g["counts"]["severity_labeled_pairs"]}) | - |
| Impact Exact Agreement | {g["impact_exact_agreement"]:.3f} (n={g["counts"]["impact_labeled_pairs"]}) | - |
| Priority Exact Agreement | {g["priority_exact_agreement"]:.3f} (n={g["counts"]["priority_labeled_pairs"]}) | - |
| Priority Within-One Agreement | {g["priority_within_one_agreement"]:.3f} (n={g["counts"]["priority_labeled_pairs"]}) | - |
| Gold findings 総数 | {g["counts"]["gold_total"]} | - |
| マッチ数 | {g["counts"]["gold_matched"]} | - |
| Agent predictions 数 | {g["counts"]["pred_total_for_gold"]} | - |

### Seeded set（意図的バグ注入の検出率）

| 指標 | 値 | 目標 |
|---|---|---|
| Must-Find Recall | {s["must_find_recall"]:.3f} | ≥ 0.95 |
| Critical Miss Rate | {s["critical_miss_rate"]:.3f} | = 0 |
| Seeded issues 総数 | {s["counts"]["seeded_total"]} | - |
| 検出数 | {s["counts"]["seeded_detected"]} | - |
| Critical 総数 | {s["counts"]["seeded_critical_total"]} | - |
| Critical 見逃し | {s["counts"]["seeded_critical_missed"]} | - |

## Gold Set 詳細（PR ごとの人間レビュー指摘 vs Agent 指摘）

{gold_detail}
## Seeded Set 詳細（項目ごとの Must-Find vs Agent 指摘）

{seeded_detail}
## Hard Gate 判定

**結果: {hard_gate}**

- Critical Miss Rate = 0: {"✅" if critical_miss_ok else "❌"} ({s["critical_miss_rate"]:.3f})
- Must-Find Recall ≥ 0.95: {"✅" if must_find_ok else "❌"} ({s["must_find_recall"]:.3f})
{failure_section}"""


def main() -> int:
    setup_logging()
    parser = argparse.ArgumentParser(
        description="Score predictions and generate the Markdown report + Discord notification"
    )
    parser.add_argument("--gold", required=True, help="Gold JSONL path")
    parser.add_argument("--seeded", required=True, help="Seeded JSONL path")
    parser.add_argument("--pred", required=True, help="Predictions JSONL path")
    parser.add_argument(
        "--failed-ids-file",
        default=None,
        help="Path to a JSON array of ids that failed evaluation. Defaults to "
        "the sidecar next to --pred (<pred-stem>.failed_ids.json).",
    )
    parser.add_argument(
        "--allow-missing-failed-ids",
        action="store_true",
        help="Treat a missing failed_ids sidecar as zero failures instead of "
        "a fatal error. Off by default: in the normal pipeline the sidecar "
        "always exists (written by run_agent_evaluation.py or "
        "merge_predictions.py), so its absence usually means failures are "
        "being silently undercounted.",
    )
    args = parser.parse_args()
    return _generate_report(args)


def _generate_report(args: argparse.Namespace) -> int:
    model_id = os.getenv("CODE_REVIEW_MODEL_ID", "gpt-4o")
    commit_hash = _get_commit_hash()
    # Single instant for both: the body's 実行日時 and the filename timestamp
    # used to disagree because they were two independent datetime.now() calls
    # in different timezones (UTC vs local), which could show different dates
    # near a local midnight. UTC is used for the filename (not local time) so
    # both stay consistent with each other and with `executed_at`.
    now = datetime.now(timezone.utc)
    executed_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    ts_str = now.strftime("%Y%m%d-%H%M%S")

    gold_items = read_jsonl(args.gold)
    seeded_items = read_jsonl(args.seeded)
    try:
        failed_ids = _load_failed_ids(
            args.pred, args.failed_ids_file, args.allow_missing_failed_ids
        )
    except FileNotFoundError as e:
        logger.error("%s", e)
        return 5

    logger.info("--- Scoring ---")
    try:
        scores = _score(args.gold, args.seeded, args.pred)
        logger.info("Scores:\n%s", json.dumps(scores, indent=2))
    except Exception as e:
        logger.error("Scoring failed: %s", e)
        return 4

    report_md = _build_report(
        scores, gold_items, seeded_items, commit_hash, model_id, executed_at, failed_ids
    )
    report_filename = f"report_{ts_str}-{commit_hash}.md"
    report_path = Path(args.pred).parent / report_filename
    report_path.write_text(report_md, encoding="utf-8")
    logger.info("Report written: %s", report_path)

    send_discord_notification(
        os.environ.get("DISCORD_WEBHOOK_URL"),
        build_notification_payload(
            scores, failed_ids, report_path, commit_hash, model_id, executed_at
        ),
    )

    return 1 if failed_ids else 0


if __name__ == "__main__":
    raise SystemExit(main())
