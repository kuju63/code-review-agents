#!/usr/bin/env python3
"""Run code review agent against Gold/Seeded evaluation datasets via A2A API.

Usage:
  python evaluation/tools/run_agent_evaluation.py \
    --gold evaluation/data/gold_pr_set.jsonl \
    --seeded evaluation/data/seeded_set.jsonl \
    --output evaluation/data/agent_predictions.jsonl

The A2A server must be running at --base-url (default: http://localhost:8000).
All environment variables (GITHUB_TOKEN, CODE_REVIEW_MODEL_ID, etc.) are loaded from .env.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx
from dotenv import load_dotenv

from a2a_client import a2a_poll, a2a_send
from discord_notify import build_notification_payload, send_discord_notification

load_dotenv()

_DEFAULT_BASE_URL = "http://localhost:8000"
_DEFAULT_POLL_INTERVAL = 3
_DEFAULT_TIMEOUT = 1800
_DEFAULT_CONCURRENCY = 2


def _run_a2a(
    client: httpx.Client,
    endpoint: str,
    data: dict[str, Any],
    poll_interval: float,
    timeout: float,
) -> dict[str, Any]:
    task_id = a2a_send(client, endpoint, data)
    return a2a_poll(client, endpoint, task_id, poll_interval, timeout)


def _to_predictions(lead_report_data: dict[str, Any], pr_id: str) -> dict[str, Any]:
    """Convert LeadEngineerReport dict to agent_predictions.jsonl format.

    Category is normalized to "unknown" because the agent uses perspective-based
    categories (technical/security) that don't match the Gold/Seeded taxonomy
    (correctness/performance/etc.), causing is_match() to reject all non-unknown pairs.
    Matching falls back to path+line+severity which is the intended signal.

    Returns:
        The item in ``agent_predictions.jsonl`` format, category-normalized.
    """
    from code_review_agent.models.lead_engineer import LeadEngineerReport

    report = LeadEngineerReport.model_validate(lead_report_data)
    pred = report.to_evaluation_format(pr_id)
    for finding in pred.get("agent_findings", []):
        if finding.get("category") != "security":
            finding["category"] = "unknown"
    return pred


def evaluate_gold_item(
    item: dict[str, Any],
    client: httpx.Client,
    base_url: str,
    poll_interval: float,
    timeout: float,
    model_id: str,
) -> dict[str, Any]:
    """Evaluate a gold PR item via the orchestrator endpoint.

    Returns:
        The orchestrator's result, converted to ``agent_predictions.jsonl``
        format.
    """
    owner, repo = item["repository"].split("/")
    data = {
        "owner": owner,
        "repo": repo,
        "pr_number": item["pr_number"],
        "model_id": model_id,
    }
    lead_data = _run_a2a(
        client, f"{base_url}/orchestrator", data, poll_interval, timeout
    )
    return _to_predictions(lead_data, item["id"])


def evaluate_seeded_item(
    item: dict[str, Any],
    client: httpx.Client,
    base_url: str,
    poll_interval: float,
    timeout: float,
    model_id: str,
) -> dict[str, Any]:
    """Evaluate a seeded item: collect real PR metadata, inject seeded file_changes.

    Returns:
        The lead engineer's synthesized result, converted to
        ``agent_predictions.jsonl`` format.
    """
    owner, repo = item["repository"].split("/")
    pr_number = item["pr_number"]

    # Step 1: Collect PR info (real PR metadata)
    pr_info_data = _run_a2a(
        client,
        f"{base_url}/pr-info-collector",
        {"owner": owner, "repo": repo, "pr_number": pr_number, "model_id": model_id},
        poll_interval,
        timeout,
    )

    # Step 2: Override file_changes with seeded mutations
    # seeded format: {"path": ..., "patch": ...}
    # PRInfoResult format: file_changes[].filePath and .patch
    seeded_file_changes = [
        {"filePath": fc["path"], "patch": fc.get("patch")}
        for fc in item.get("file_changes", [])
        if fc.get("patch")
    ]
    pr_info_data["pr_info"]["file_changes"] = seeded_file_changes

    # Step 3: Run Frontend reviewer and Security reviewer in parallel.
    # They are independent of each other's output, so running them
    # concurrently only affects wall-clock time, not what is found.
    with ThreadPoolExecutor(max_workers=2) as executor:
        frontend_future = executor.submit(
            _run_a2a,
            client,
            f"{base_url}/frontend-reviewer",
            {"pr_info": pr_info_data, "model_id": model_id},
            poll_interval,
            timeout,
        )
        security_future = executor.submit(
            _run_a2a,
            client,
            f"{base_url}/security-reviewer",
            {"pr_info": pr_info_data, "model_id": model_id},
            poll_interval,
            timeout,
        )
        frontend_result = frontend_future.result()
        security_result = security_future.result()

    # Step 4: Lead engineer synthesis
    review_report = {"results": [frontend_result, security_result], "errors": []}
    lead_data = _run_a2a(
        client,
        f"{base_url}/lead-engineer",
        {"review_report": review_report, "model_id": model_id},
        poll_interval,
        timeout,
    )

    return _to_predictions(lead_data, item["id"])


def _evaluate_concurrently(
    items: list[dict[str, Any]],
    evaluate_fn: Callable[[dict[str, Any]], dict[str, Any]],
    concurrency: int,
    label_fn: Callable[[dict[str, Any]], str] = lambda item: item["id"],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Evaluate ``items`` with at most ``concurrency`` running at once.

    Both preserve the original item order regardless of completion order,
    so output files and scores stay reproducible across runs and across
    --concurrency values.

    Returns:
        A ``(predictions, failed_ids)`` tuple: successful predictions in
        original item order, and the ``id`` of every item that raised.
    """
    results: list[dict[str, Any] | None] = [None] * len(items)
    failed_flags: list[bool] = [False] * len(items)
    print_lock = threading.Lock()

    def _run_one(index: int, item: dict[str, Any]) -> None:
        label = label_fn(item)[:60]
        with print_lock:
            print(f"  [{label}] ... started", flush=True)
        try:
            pred = evaluate_fn(item)
            results[index] = pred
            with print_lock:
                print(
                    f"  [{label}] ... done ({len(pred['agent_findings'])} findings)",
                    flush=True,
                )
        except Exception as e:
            failed_flags[index] = True
            with print_lock:
                print(f"  [{label}] ... WARN: {e}", flush=True)

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as executor:
        futures = [executor.submit(_run_one, i, item) for i, item in enumerate(items)]
        for future in as_completed(futures):
            future.result()

    predictions = [r for r in results if r is not None]
    failed_ids = [items[i]["id"] for i, flag in enumerate(failed_flags) if flag]
    return predictions, failed_ids


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


def _score(gold_path: str, seeded_path: str, pred_path: str) -> dict[str, Any]:
    """Run score_evaluation.py and return the parsed JSON result.

    Returns:
        The parsed JSON object printed by ``score_evaluation.py`` on stdout.

    Raises:
        RuntimeError: If ``score_evaluation.py`` exits with a non-zero
            status.
    """
    score_script = Path(__file__).parent / "score_evaluation.py"
    result = subprocess.run(
        [
            sys.executable,
            str(score_script),
            "--gold",
            gold_path,
            "--seeded",
            seeded_path,
            "--pred",
            pred_path,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"score_evaluation.py failed:\n{result.stderr}")
    return json.loads(result.stdout)


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
    summary = _sanitize_cell(raw.get("summary", ""))
    ref = _sanitize_cell(_ref_cell(raw))
    return f"| {kind} | `{path}:{line}` | {category} | {severity} | {summary} | {ref} |"


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
        "| 種別 | Path:Line | Category | Severity | Summary | Ref |\n"
        "|---|---|---|---|---|---|\n" + "\n".join(rows)
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


def read_jsonl(path: str) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _shutdown_server(pid_file: str | None) -> None:
    """Send SIGTERM to the A2A server process identified by *pid_file*.

    No-ops gracefully when the file is absent, unreadable, or the process is
    already gone.  Called in a ``finally`` block so evaluation output is
    written before the server is stopped.
    """
    if not pid_file:
        return
    try:
        pid = int(Path(pid_file).read_text().strip())
        os.kill(pid, signal.SIGTERM)
        logging.info("A2A server (PID %d) terminated via %s", pid, pid_file)
        Path(pid_file).unlink(missing_ok=True)
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError) as exc:
        logging.debug("_shutdown_server: %s", exc)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run agent evaluation via A2A API")
    parser.add_argument("--gold", required=True, help="Gold JSONL path")
    parser.add_argument("--seeded", required=True, help="Seeded JSONL path")
    parser.add_argument("--output", required=True, help="Predictions JSONL output path")
    parser.add_argument(
        "--base-url", default=_DEFAULT_BASE_URL, help="A2A server base URL"
    )
    parser.add_argument("--poll-interval", type=float, default=_DEFAULT_POLL_INTERVAL)
    parser.add_argument("--timeout", type=float, default=_DEFAULT_TIMEOUT)
    parser.add_argument(
        "--concurrency",
        type=int,
        default=_DEFAULT_CONCURRENCY,
        help=(
            "Max number of Gold/Seeded items evaluated at once (default: 2). "
            "A realistic ceiling is hardware- and rate-limit-dependent; raising "
            "it increases the risk of hitting --timeout on individual items."
        ),
    )
    parser.add_argument(
        "--server-pid-file",
        default=None,
        help="Path to a file containing the A2A server PID.  When set, the "
        "server is sent SIGTERM after evaluation finishes (success or failure).",
    )
    args = parser.parse_args()

    args.base_url = args.base_url.rstrip("/")

    try:
        return _run_evaluation(args)
    finally:
        _shutdown_server(args.server_pid_file)


def _run_evaluation(args: argparse.Namespace) -> int:
    github_token = os.environ.get("GITHUB_TOKEN")
    if not github_token:
        print("GITHUB_TOKEN is required (set in .env)", file=sys.stderr)
        return 2

    model_id = os.getenv("CODE_REVIEW_MODEL_ID", "gpt-4o")
    commit_hash = _get_commit_hash()
    executed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ts_str = datetime.now().strftime("%Y%m%d-%H%M%S")

    gold_items = read_jsonl(args.gold)
    seeded_items = read_jsonl(args.seeded)

    print(f"Gold items: {len(gold_items)}, Seeded items: {len(seeded_items)}")
    print(f"Commit: {commit_hash}, Model: {model_id}")

    headers = {"Authorization": f"Bearer {github_token}"}
    predictions: list[dict[str, Any]] = []
    failed_ids: list[str] = []

    with httpx.Client(headers=headers) as client:
        # Health check
        try:
            client.get(f"{args.base_url}/docs", timeout=5)
        except Exception as e:
            print(
                f"[ERROR] A2A server not reachable at {args.base_url}: {e}",
                file=sys.stderr,
            )
            return 3

        print(f"\n--- Gold set evaluation (concurrency={args.concurrency}) ---")
        gold_predictions, gold_failed = _evaluate_concurrently(
            gold_items,
            lambda item: evaluate_gold_item(
                item, client, args.base_url, args.poll_interval, args.timeout, model_id
            ),
            args.concurrency,
        )
        predictions.extend(gold_predictions)
        failed_ids.extend(gold_failed)

        print(f"\n--- Seeded set evaluation (concurrency={args.concurrency}) ---")
        seeded_predictions, seeded_failed = _evaluate_concurrently(
            seeded_items,
            lambda item: evaluate_seeded_item(
                item, client, args.base_url, args.poll_interval, args.timeout, model_id
            ),
            args.concurrency,
        )
        predictions.extend(seeded_predictions)
        failed_ids.extend(seeded_failed)

    if failed_ids:
        print(
            f"\n[WARN] {len(failed_ids)} item(s) failed — scores reflect partial results only:",
            file=sys.stderr,
        )
        for fid in failed_ids:
            print(f"  - {fid}", file=sys.stderr)

    # Write predictions
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        for pred in predictions:
            f.write(json.dumps(pred, ensure_ascii=False) + "\n")
    print(f"\nPredictions written: {args.output} ({len(predictions)} items)")

    # Score
    print("\n--- Scoring ---")
    try:
        scores = _score(args.gold, args.seeded, args.output)
        print(json.dumps(scores, indent=2))
    except Exception as e:
        print(f"[ERROR] Scoring failed: {e}", file=sys.stderr)
        return 4

    # Build and write report
    report_md = _build_report(
        scores, gold_items, seeded_items, commit_hash, model_id, executed_at, failed_ids
    )
    report_filename = f"report_{ts_str}-{commit_hash}.md"
    report_path = Path(args.output).parent / report_filename
    report_path.write_text(report_md, encoding="utf-8")
    print(f"\nReport written: {report_path}")

    send_discord_notification(
        os.environ.get("DISCORD_WEBHOOK_URL"),
        build_notification_payload(
            scores, failed_ids, report_path, commit_hash, model_id, executed_at
        ),
    )

    return 1 if failed_ids else 0


if __name__ == "__main__":
    raise SystemExit(main())
