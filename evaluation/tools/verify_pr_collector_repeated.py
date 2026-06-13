#!/usr/bin/env python3
"""Repeatedly run PRInfoCollector against one real PR for statistical analysis.

Calls ``PRInfoCollector.collect()`` directly (no A2A server needed) N times
and records each structured output as one JSON line, so accuracy and run-to-run
variance can be analysed statistically.

Usage:
  python evaluation/tools/verify_pr_collector_repeated.py [--runs 20]

Environment (read from .env):
  GITHUB_TOKEN               GitHub token (required)
  CODE_REVIEW_MODEL_ID       Model id (default: google/gemma-4-e4b)
  CODE_REVIEW_LLM_BASE_URL   OpenAI-compatible base URL (e.g. LM Studio)

Output:
  evaluation/data/pr_collector_repeated_<model>.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import os  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from code_review_agent.agents.pr_info_collector import PRInfoCollector  # noqa: E402

_OWNER = "mui"
_REPO = "material-ui"
_PR_NUMBER = 48591


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=20)
    args = parser.parse_args()

    github_token = os.environ.get("GITHUB_TOKEN")
    if not github_token:
        print("ERROR: GITHUB_TOKEN not set", file=sys.stderr)
        sys.exit(1)

    model_id = os.environ.get("CODE_REVIEW_MODEL_ID", "google/gemma-4-e4b")
    base_url = os.environ.get("CODE_REVIEW_LLM_BASE_URL")

    # Sanitise filesystem-unfriendly characters so model ids like the Ollama
    # form ``gemma4:e4b`` (documented in .env.example) do not produce filenames
    # containing ``:`` (invalid on Windows) or other path-hostile characters.
    safe_model = re.sub(r'[/\\:*?"<>|]', "_", model_id)
    out = (
        Path(__file__).parent.parent
        / "data"
        / f"pr_collector_repeated_{safe_model}.jsonl"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    # Fresh start for a clean statistical run.
    if out.exists():
        out.unlink()

    print(f"Model: {model_id}  base_url: {base_url}")
    print(f"Target: {_OWNER}/{_REPO}#{_PR_NUMBER}  runs: {args.runs}")
    print(f"Output: {out}")

    for i in range(1, args.runs + 1):
        started = datetime.now(timezone.utc).isoformat()
        t0 = time.monotonic()
        record: dict = {"run": i, "model": model_id, "started_at": started}
        try:
            collector = PRInfoCollector(
                github_token=github_token,
                model_id=model_id,
                llm_base_url=base_url,
            )
            result = collector.collect(_OWNER, _REPO, _PR_NUMBER)
            elapsed = time.monotonic() - t0
            record.update(
                {
                    "status": "completed",
                    "elapsed_s": round(elapsed, 2),
                    "owner": result.repository_info.owner,
                    "repository": result.repository_info.repository,
                    "project_summary_len": len(result.project_summary or ""),
                    "title": result.pr_info.title,
                    "pr_number": result.pr_info.pr_number,
                    "body": result.pr_info.body,
                    "labels": result.pr_info.labels,
                    "file_paths": [fc.filePath for fc in result.pr_info.file_changes],
                    "dependency_files": result.dependency_files,
                }
            )
            print(
                f"[{i}/{args.runs}] completed in {elapsed:.1f}s "
                f"title={result.pr_info.title!r} files={len(result.pr_info.file_changes)}"
            )
        except Exception as exc:
            elapsed = time.monotonic() - t0
            record.update(
                {
                    "status": "error",
                    "elapsed_s": round(elapsed, 2),
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
            print(f"[{i}/{args.runs}] ERROR in {elapsed:.1f}s: {exc}")
        record["finished_at"] = datetime.now(timezone.utc).isoformat()
        with out.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"\nDone. {args.runs} runs written to {out}")


if __name__ == "__main__":
    main()
