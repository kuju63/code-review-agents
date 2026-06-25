#!/usr/bin/env python3
"""Measure the actual pr_info_collector response size for specified PRs.

Calls the A2A /pr-info-collector endpoint for each target PR and reports
the size breakdown of the response. Patch content is not included in
pr_info_collector output (reviewers fetch it on demand), so patch_bytes
will always be zero; other metrics (total, body, project_summary) remain
valid. PR_INFO_COLLECTOR_RESPONSE_FILE must be set (in .env) so the server
writes the response to disk for independent verification.

Usage:
  # Start the A2A server first, then:
  python evaluation/tools/measure_pr_info_response.py [--base-url URL]
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from a2a_client import a2a_poll, a2a_send

load_dotenv()

_DEFAULT_BASE_URL = "http://localhost:8000"
_POLL_INTERVAL = 3
_TIMEOUT = 300  # pr_info_collector itself should complete well within 5 min

_TARGETS = [
    ("mui", "material-ui", 48325),
    ("mui", "material-ui", 48591),
]


def _measure(result: dict[str, Any], response_file: str | None) -> dict[str, Any]:
    result_json = json.dumps(result, ensure_ascii=False)
    total_bytes = len(result_json.encode("utf-8"))

    file_changes = result.get("pr_info", {}).get("file_changes", [])
    patch_bytes = sum(
        len((fc.get("patch") or "").encode("utf-8")) for fc in file_changes
    )
    project_summary = result.get("project_summary") or ""
    body = result.get("pr_info", {}).get("body") or ""

    file_details = []
    for fc in file_changes:
        path = fc.get("filePath") or fc.get("path") or "?"
        size = len((fc.get("patch") or "").encode("utf-8"))
        file_details.append((path, size))
    file_details.sort(key=lambda x: x[1], reverse=True)

    # Verify against the file written by PR_INFO_COLLECTOR_RESPONSE_FILE
    file_size = None
    if response_file and Path(response_file).exists():
        file_size = Path(response_file).stat().st_size

    return {
        "total_bytes": total_bytes,
        "patch_bytes": patch_bytes,
        "file_changes_count": len(file_changes),
        "project_summary_bytes": len(project_summary.encode("utf-8")),
        "body_bytes": len(body.encode("utf-8")),
        "dependency_files": result.get("dependency_files", []),
        "file_details": file_details,
        "file_written_bytes": file_size,
    }


def _print_report(pr_id: str, metrics: dict[str, Any]) -> None:
    total_kb = metrics["total_bytes"] / 1024
    print(f"\n{'=' * 60}")
    print(f"PR: {pr_id}")
    print(f"{'=' * 60}")
    print(
        f"  Total response size : {metrics['total_bytes']:>10,} bytes  ({total_kb:.1f} KB)"
    )
    if metrics["file_written_bytes"] is not None:
        print(
            f"  File on disk        : {metrics['file_written_bytes']:>10,} bytes  (PR_INFO_COLLECTOR_RESPONSE_FILE)"
        )
    print(f"  file_changes count  : {metrics['file_changes_count']}")
    print(
        f"  Patch total         : {metrics['patch_bytes']:>10,} bytes  "
        f"(always 0 — patch delegated to reviewers)"
    )
    print(f"  PR body             : {metrics['body_bytes']:>10,} bytes")
    print(f"  project_summary     : {metrics['project_summary_bytes']:>10,} bytes")
    print(f"  dependency_files    : {metrics['dependency_files']}")
    print("\n  Top files by filename (patch size is always 0):")
    for path, size in metrics["file_details"][:10]:
        print(f"    {path}")
    if len(metrics["file_details"]) > 10:
        print(f"    ... and {len(metrics['file_details']) - 10} more files")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=_DEFAULT_BASE_URL)
    args = parser.parse_args()

    response_file = os.environ.get("PR_INFO_COLLECTOR_RESPONSE_FILE")
    model_id = os.environ.get("CODE_REVIEW_MODEL_ID", "gpt-4o")

    print(f"Target A2A server : {args.base_url}")
    print(f"Model             : {model_id}")
    print(f"Response file     : {response_file or '(not set)'}")

    github_token = os.environ.get("GITHUB_TOKEN", "")
    headers = {"Authorization": f"Bearer {github_token}"}

    with httpx.Client(headers=headers, base_url=args.base_url) as client:
        try:
            client.get("/docs", timeout=5).raise_for_status()
            print("A2A server: OK\n")
        except Exception as e:
            print(
                f"ERROR: A2A server not reachable at {args.base_url}: {e}",
                file=sys.stderr,
            )
            sys.exit(1)

        results = []
        for owner, repo, pr_number in _TARGETS:
            pr_id = f"{owner}/{repo}#{pr_number}"
            print(f"\n[{pr_id}] Calling /pr-info-collector ...", flush=True)
            try:
                data = {
                    "owner": owner,
                    "repo": repo,
                    "pr_number": pr_number,
                    "model_id": model_id,
                }
                task_id = a2a_send(client, f"{args.base_url}/pr-info-collector", data)
                print(f"  task_id: {task_id}", flush=True)
                result = a2a_poll(
                    client,
                    f"{args.base_url}/pr-info-collector",
                    task_id,
                    poll_interval=_POLL_INTERVAL,
                    timeout=_TIMEOUT,
                    verbose=True,
                )
                metrics = _measure(result, response_file)
                _print_report(pr_id, metrics)
                results.append({"id": pr_id, "metrics": metrics})

                # Save individual response for inspection
                if response_file:
                    dest = Path(response_file).with_stem(
                        Path(response_file).stem + f"_{pr_number}"
                    )
                    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2))
                    print(f"\n  Saved response to: {dest}")

            except Exception as e:
                print(f"  ERROR: {e}", file=sys.stderr)
                results.append({"id": pr_id, "error": str(e)})

    print("\n\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for r in results:
        if "error" in r:
            print(f"  {r['id']}: ERROR - {r['error']}")
        else:
            m = r["metrics"]
            print(
                f"  {r['id']}: {m['total_bytes']:,} bytes "
                f"({m['total_bytes'] / 1024:.1f} KB), "
                f"{m['file_changes_count']} files"
            )


if __name__ == "__main__":
    main()
