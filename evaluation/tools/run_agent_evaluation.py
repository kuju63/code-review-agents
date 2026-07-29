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
from pathlib import Path
from typing import Any, Callable

import httpx
from dotenv import load_dotenv

from a2a_client import a2a_poll, a2a_send

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

    # Step 3: Run the React reviewer and Security reviewer in parallel.
    # They are independent of each other's output, so running them
    # concurrently only affects wall-clock time, not what is found.
    with ThreadPoolExecutor(max_workers=2) as executor:
        technical_future = executor.submit(
            _run_a2a,
            client,
            f"{base_url}/react-reviewer",
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
        technical_result = technical_future.result()
        security_result = security_future.result()

    # Step 4: Lead engineer synthesis
    review_report = {"results": [technical_result, security_result], "errors": []}
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


def read_jsonl(path: str) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _select_shard(
    items: list[dict[str, Any]], shard_index: int, shard_count: int
) -> list[dict[str, Any]]:
    """Positionally partition *items* into *shard_count* round-robin buckets.

    Applied independently to Gold and Seeded so each dataset divides evenly;
    recombining every shard's output reproduces the original set with no
    overlap or gaps, as long as all shards run against the same input file
    (see docs/eval-sharded-execution-spec.md §2.2).

    Returns:
        Every item whose original index satisfies
        ``index % shard_count == shard_index``.
    """
    return items[shard_index::shard_count]


def _validate_shard_args(shard_index: int | None, shard_count: int | None) -> None:
    """Validate ``--shard-index``/``--shard-count`` before any work starts.

    Raises:
        ValueError: If exactly one of the two is set, ``shard_count`` is
            less than 1, or ``shard_index`` is out of ``[0, shard_count)``.
    """
    if (shard_index is None) != (shard_count is None):
        raise ValueError("--shard-index and --shard-count must be provided together")
    if shard_count is None or shard_index is None:
        return
    if shard_count < 1:
        raise ValueError(f"--shard-count must be >= 1, got {shard_count}")
    if not (0 <= shard_index < shard_count):
        raise ValueError(
            f"--shard-index must satisfy 0 <= index < {shard_count}, got {shard_index}"
        )


def _failed_ids_path(pred_path: str) -> Path:
    """Sidecar path recording ids that raised during evaluation.

    Naming convention shared with generate_evaluation_report.py and
    merge_predictions.py: ``agent_predictions.jsonl`` ->
    ``agent_predictions.failed_ids.json``.

    Returns:
        The sidecar path derived from *pred_path*.
    """
    p = Path(pred_path)
    return p.with_name(p.stem + ".failed_ids.json")


def _write_predictions_and_sidecar(
    output_path: str, predictions: list[dict[str, Any]], failed_ids: list[str]
) -> None:
    """Write predictions and the failed_ids sidecar, always (shard or not).

    The sidecar lets merge_predictions.py and generate_evaluation_report.py
    distinguish a known per-item failure from an id that never ran at all
    (see docs/eval-sharded-execution-spec.md §2.4).
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        for pred in predictions:
            f.write(json.dumps(pred, ensure_ascii=False) + "\n")
    _failed_ids_path(output_path).write_text(
        json.dumps(failed_ids, ensure_ascii=False), encoding="utf-8"
    )


def _is_sharded(args: argparse.Namespace) -> bool:
    """Whether *args* selects a sharded (partial-dataset) run.

    The single source of truth for the shard/non-shard branch used by
    ``_run_evaluation`` (item filtering), ``_maybe_generate_report`` (report
    subprocess), and ``main()`` (server-shutdown guard) -- kept in one place
    so those three checks can't drift out of sync.

    Returns:
        ``True`` when ``--shard-count`` was provided.
    """
    return args.shard_count is not None


def _maybe_generate_report(args: argparse.Namespace) -> int | None:
    """Invoke generate_evaluation_report.py for a non-sharded run.

    A sharded run's predictions are only a partial dataset, so scoring and
    report generation are deferred to a separate step run after
    merge_predictions.py combines every shard's output.

    Returns:
        ``None`` when sharding is active (nothing was invoked), otherwise
        generate_evaluation_report.py's exit code, returned unconverted (one
        of 0-5: 0 success, 1 partial/failed_ids present, 4 scoring failed, 5
        failed_ids sidecar missing without --allow-missing-failed-ids). This
        becomes ``main()``'s own exit code for a non-sharded run.
    """
    if _is_sharded(args):
        return None
    report_script = Path(__file__).parent / "generate_evaluation_report.py"
    result = subprocess.run(
        [
            sys.executable,
            str(report_script),
            "--gold",
            args.gold,
            "--seeded",
            args.seeded,
            "--pred",
            args.output,
        ],
    )
    return result.returncode


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
        "server is sent SIGTERM after evaluation finishes (success or failure) "
        "-- unless --shard-count is set (see below).",
    )
    parser.add_argument(
        "--shard-index",
        type=int,
        default=None,
        help="0-based shard index. Must be paired with --shard-count. When "
        "set, only every --shard-count-th Gold/Seeded item (starting at this "
        "index) is evaluated, report generation is skipped (run "
        "generate_evaluation_report.py after merge_predictions.py), and the "
        "A2A server is not shut down even if --server-pid-file is set (see "
        "docs/eval-sharded-execution-spec.md).",
    )
    parser.add_argument(
        "--shard-count",
        type=int,
        default=None,
        help="Total number of shards. Must be paired with --shard-index.",
    )
    args = parser.parse_args()

    args.base_url = args.base_url.rstrip("/")

    # _validate_shard_args() runs inside the try block (not before it) so
    # that invalid --shard-index/--shard-count combinations still reach the
    # finally clause instead of leaking the A2A server because validation
    # raised first. Its ValueError is caught and mapped to the established
    # fatal-argument-error exit code (2) rather than propagating as an
    # uncaught exception.
    #
    # shard_validation_ok gates the finally-block shutdown decision alongside
    # _is_sharded(args): args.shard_count alone is not enough to tell "a
    # validated sharded run" apart from "an invalid combination that happens
    # to have shard_count set" (e.g. --shard-index 5 --shard-count 4, where
    # shard_count is 4, not None). Only a *validated* sharded run should skip
    # shutdown; any failed validation must shut the server down like a
    # non-sharded run, regardless of which fields were provided.
    shard_validation_ok = False
    try:
        try:
            _validate_shard_args(args.shard_index, args.shard_count)
            shard_validation_ok = True
        except ValueError as e:
            print(f"[ERROR] Invalid shard arguments: {e}", file=sys.stderr)
            return 2
        return _run_evaluation(args)
    finally:
        if not (shard_validation_ok and _is_sharded(args)):
            _shutdown_server(args.server_pid_file)


def _run_evaluation(args: argparse.Namespace) -> int:
    github_token = os.environ.get("GITHUB_TOKEN")
    if not github_token:
        print("GITHUB_TOKEN is required (set in .env)", file=sys.stderr)
        return 2

    model_id = os.getenv("CODE_REVIEW_MODEL_ID", "gpt-4o")
    commit_hash = _get_commit_hash()

    gold_items = read_jsonl(args.gold)
    seeded_items = read_jsonl(args.seeded)

    if _is_sharded(args):
        gold_items = _select_shard(gold_items, args.shard_index, args.shard_count)
        seeded_items = _select_shard(seeded_items, args.shard_index, args.shard_count)
        print(
            f"Shard {args.shard_index}/{args.shard_count}: "
            f"Gold items: {len(gold_items)}, Seeded items: {len(seeded_items)}"
        )
    else:
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

    # Write predictions + failed_ids sidecar (always, shard or not -- see
    # docs/eval-sharded-execution-spec.md §2.4)
    _write_predictions_and_sidecar(args.output, predictions, failed_ids)
    print(f"\nPredictions written: {args.output} ({len(predictions)} items)")

    report_exit_code = _maybe_generate_report(args)
    if report_exit_code is not None:
        return report_exit_code

    print(
        "\nShard run: skipping report generation. After all shards finish, "
        "merge with merge_predictions.py and run generate_evaluation_report.py."
    )
    return 1 if failed_ids else 0


if __name__ == "__main__":
    raise SystemExit(main())
