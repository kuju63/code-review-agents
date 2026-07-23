#!/usr/bin/env python3
"""Build Gold PR dataset from GitHub pull requests.

Usage:
  python evaluation/tools/build_gold_set.py \
    --input evaluation/data/pr_targets.json \
    --output evaluation/data/gold_pr_set.jsonl

Input format (JSON):
[
  {"repository": "owner/repo", "pr_number": 123},
  {"repository": "owner/repo", "pr_number": 456}
]

Required env:
  GITHUB_TOKEN
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv


ALLOWED_EXTENSIONS = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".vue",
    ".svelte",
    ".css",
    ".scss",
    ".html",
}
SPECIAL_FILES = {
    "package.json",
}


def _api_get(url: str, token: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "code-review-agent-eval",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def _is_target_file(path: str) -> bool:
    for filename in SPECIAL_FILES:
        if path.endswith(filename):
            return True
    for ext in ALLOWED_EXTENSIONS:
        if path.endswith(ext):
            return True
    return False


def _normalize_severity(text: str) -> str:
    t = text.lower()
    if any(
        k in t
        for k in [
            "critical",
            "blocker",
            "rce",
            "sql injection",
            "remote code execution",
            "broken access control",
        ]
    ):
        return "critical"
    if any(
        k in t
        for k in [
            "high",
            "xss",
            "security",
            "vulnerability",
            "csrf",
            "ssrf",
            "unsafe deserialization",
            "mass assignment",
        ]
    ):
        return "high"
    if any(
        k in t for k in ["medium", "performance", "slow", "memory", "n+1", "n plus one"]
    ):
        return "medium"
    if any(k in t for k in ["low", "nit", "minor", "style"]):
        return "low"
    return "unknown"


def _normalize_category(text: str) -> str:
    t = text.lower()
    if any(
        k in t
        for k in [
            "xss",
            "csrf",
            "security",
            "token",
            "auth",
            "ssrf",
            "idor",
            "access control",
            "mass assignment",
            "sql injection",
            "unsafe deserialization",
            "cve",
        ]
    ):
        return "security"
    if any(
        k in t
        for k in [
            "slow",
            "performance",
            "render",
            "latency",
            "n+1",
            "index",
            "query plan",
        ]
    ):
        return "performance"
    if any(
        k in t
        for k in [
            "bug",
            "incorrect",
            "wrong",
            "null",
            "undefined",
            "transaction",
            "race condition",
            "consistency",
            "idempotency",
        ]
    ):
        return "correctness"
    if any(k in t for k in ["readability", "refactor", "maintain", "complex"]):
        return "maintainability"
    if any(k in t for k in ["style", "format", "naming", "lint"]):
        return "style"
    return "unknown"


def _extract_line(comment: dict[str, Any]) -> int:
    line = comment.get("line")
    if isinstance(line, int) and line > 0:
        return line
    original_line = comment.get("original_line")
    if isinstance(original_line, int) and original_line > 0:
        return original_line
    return 1


@dataclass
class Target:
    repository: str
    pr_number: int


def load_targets(path: str) -> list[Target]:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    targets: list[Target] = []
    for item in raw:
        repo = item["repository"]
        pr = int(item["pr_number"])
        targets.append(Target(repository=repo, pr_number=pr))
    return targets


def build_gold_item(target: Target, token: str) -> dict[str, Any]:
    owner, repo = target.repository.split("/", maxsplit=1)

    pr_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{target.pr_number}"
    files_url = f"{pr_url}/files?per_page=100"
    review_comments_url = f"{pr_url}/comments?per_page=100"

    pr_data = _api_get(pr_url, token)
    files_data = _api_get(files_url, token)
    comments_data = _api_get(review_comments_url, token)

    file_changes: list[dict[str, Any]] = []
    for file_item in files_data:
        path = file_item.get("filename", "")
        patch = file_item.get("patch")
        if not path or not patch:
            continue
        if _is_target_file(path):
            file_changes.append({"path": path, "patch": patch})

    human_findings: list[dict[str, Any]] = []
    for comment in comments_data:
        body = (comment.get("body") or "").strip()
        path = comment.get("path") or ""
        if not body or not path or not _is_target_file(path):
            continue
        summary = re.sub(r"\s+", " ", body)
        finding = {
            "category": _normalize_category(summary),
            "severity": _normalize_severity(summary),
            "path": path,
            "line": _extract_line(comment),
            "summary": summary,
            "source": comment.get("html_url") or pr_data.get("html_url"),
        }
        human_findings.append(finding)

    labels = [label["name"] for label in pr_data.get("labels", []) if "name" in label]

    return {
        "id": f"{target.repository}#{target.pr_number}",
        "repository": target.repository,
        "pr_number": target.pr_number,
        "title": pr_data.get("title", ""),
        "body": pr_data.get("body") or "",
        "labels": labels,
        "file_changes": file_changes,
        "human_findings": human_findings,
    }


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Build Gold PR dataset from GitHub")
    parser.add_argument("--input", required=True, help="Path to input target JSON")
    parser.add_argument("--output", required=True, help="Path to output JSONL")
    parser.add_argument(
        "--sleep", type=float, default=0.2, help="Sleep between API calls"
    )
    args = parser.parse_args()

    token = os.getenv("GITHUB_TOKEN")
    if not token:
        print("GITHUB_TOKEN is required", file=sys.stderr)
        return 2

    targets = load_targets(args.input)
    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    count = 0
    with open(args.output, "w", encoding="utf-8") as out:
        for target in targets:
            try:
                item = build_gold_item(target, token)
            except urllib.error.HTTPError as e:
                print(
                    f"[WARN] skip {target.repository}#{target.pr_number}: HTTP {e.code}"
                )
                continue
            except Exception as e:  # noqa: BLE001
                print(f"[WARN] skip {target.repository}#{target.pr_number}: {e}")
                continue

            if not item["file_changes"]:
                print(
                    f"[INFO] no target file changes: {target.repository}#{target.pr_number}"
                )
                continue
            if not item["human_findings"]:
                print(
                    f"[INFO] no review comments: {target.repository}#{target.pr_number}"
                )
                continue

            out.write(json.dumps(item, ensure_ascii=False) + "\n")
            count += 1
            time.sleep(args.sleep)

    print(f"Done. Gold items: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
