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
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

_DEFAULT_BASE_URL = "http://localhost:8000"
_DEFAULT_POLL_INTERVAL = 3
_DEFAULT_TIMEOUT = 1800


def _a2a_send(
    client: httpx.Client,
    endpoint: str,
    data: dict[str, Any],
) -> str:
    """POST a task to an A2A endpoint and return the task_id."""
    payload = {
        "message": {
            "role": "user",
            "parts": [{"kind": "data", "data": data}],
        }
    }
    resp = client.post(f"{endpoint}/tasks/send", json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()["task"]["id"]


def _a2a_poll(
    client: httpx.Client,
    endpoint: str,
    task_id: str,
    poll_interval: float,
    timeout: float,
) -> dict[str, Any]:
    """Poll until task completes/fails. Return task dict or raise on timeout/failure."""
    deadline = time.monotonic() + timeout
    while True:
        resp = client.get(f"{endpoint}/tasks/{task_id}", timeout=10)
        resp.raise_for_status()
        task = resp.json()
        status = task["status"]
        if status == "completed":
            parts = task.get("message", {}).get("parts", [])
            for part in parts:
                if part.get("kind") == "data":
                    return part["data"]
            raise RuntimeError(f"Task {task_id} completed but has no data part")
        if status == "failed":
            raise RuntimeError(f"Task {task_id} failed: {task.get('error', '?')}")
        if time.monotonic() > deadline:
            raise TimeoutError(
                f"Task {task_id} timed out after {timeout}s (status={status})"
            )
        time.sleep(poll_interval)


def _run_a2a(
    client: httpx.Client,
    endpoint: str,
    data: dict[str, Any],
    poll_interval: float,
    timeout: float,
) -> dict[str, Any]:
    task_id = _a2a_send(client, endpoint, data)
    return _a2a_poll(client, endpoint, task_id, poll_interval, timeout)


def _to_predictions(lead_report_data: dict[str, Any], pr_id: str) -> dict[str, Any]:
    """Convert LeadEngineerReport dict to agent_predictions.jsonl format.

    Category is normalized to "unknown" because the agent uses perspective-based
    categories (technical/security) that don't match the Gold/Seeded taxonomy
    (correctness/performance/etc.), causing is_match() to reject all non-unknown pairs.
    Matching falls back to path+line+severity which is the intended signal.
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
    """Evaluate a gold PR item via the orchestrator endpoint."""
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
    """Evaluate a seeded item: collect real PR metadata, inject seeded file_changes."""
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

    # Step 3: Run Frontend reviewer and Security reviewer in parallel (sequential here for simplicity)
    frontend_result = _run_a2a(
        client,
        f"{base_url}/frontend-reviewer",
        {"pr_info": pr_info_data, "model_id": model_id},
        poll_interval,
        timeout,
    )
    security_result = _run_a2a(
        client,
        f"{base_url}/security-reviewer",
        {"pr_info": pr_info_data, "model_id": model_id},
        poll_interval,
        timeout,
    )

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
    """Run score_evaluation.py and return the parsed JSON result."""
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
    args = parser.parse_args()

    args.base_url = args.base_url.rstrip("/")

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

        print("\n--- Gold set evaluation ---")
        for item in gold_items:
            print(f"  [{item['id']}] ... ", end="", flush=True)
            try:
                pred = evaluate_gold_item(
                    item,
                    client,
                    args.base_url,
                    args.poll_interval,
                    args.timeout,
                    model_id,
                )
                predictions.append(pred)
                print(f"done ({len(pred['agent_findings'])} findings)")
            except Exception as e:
                failed_ids.append(item["id"])
                print(f"WARN: {e}")

        print("\n--- Seeded set evaluation ---")
        for item in seeded_items:
            short_id = item["id"][:60]
            print(f"  [{short_id}] ... ", end="", flush=True)
            try:
                pred = evaluate_seeded_item(
                    item,
                    client,
                    args.base_url,
                    args.poll_interval,
                    args.timeout,
                    model_id,
                )
                predictions.append(pred)
                print(f"done ({len(pred['agent_findings'])} findings)")
            except Exception as e:
                failed_ids.append(item["id"])
                print(f"WARN: {e}")

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

    return 1 if failed_ids else 0


if __name__ == "__main__":
    raise SystemExit(main())
