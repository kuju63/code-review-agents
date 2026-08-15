#!/usr/bin/env python3
"""End-to-end A2A API verification against a real GitHub pull request.

Requires the server to be running before executing this script:
  uv run code-review-agent &

Usage:
  python evaluation/tools/verify_a2a_api.py

Environment (read from .env):
  GITHUB_TOKEN        GitHub OAuth token (required)
  CODE_REVIEW_AGENT_BASE_URL  Server base URL (default: http://localhost:8000)

Output:
  evaluation/data/a2a_verification.jsonl — one JSON line per agent check
"""

from __future__ import annotations

import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

# ── .env loading must be the very first action ──────────────────────────────
load_dotenv()

import os  # noqa: E402

from eval_logging import setup_logging  # noqa: E402

logger = logging.getLogger(__name__)

# ── Verification targets ────────────────────────────────────────────────────
_OWNER = "carbon-design-system"
_REPO = "carbon-addons-iot-react"
_PR_NUMBER = 4096

_AGENTS = [
    "pr-info-collector",
    "orchestrator",
]

_POLL_INTERVAL_S = 10
_TIMEOUT_S = 1800

_OUTPUT = Path(__file__).parent.parent / "data" / "a2a_verification.jsonl"


def _require_env(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        logger.error("%s is not set. Add it to .env and retry.", key)
        sys.exit(1)
    return value


def _send_task(base_url: str, agent: str, github_token: str) -> str:
    import urllib.request

    payload_data = {
        "owner": _OWNER,
        "repo": _REPO,
        "prNumber": _PR_NUMBER,
    }

    payload = json.dumps(
        {
            "message": {
                "role": "user",
                "parts": [{"kind": "data", "data": payload_data}],
            }
        }
    ).encode()

    req = urllib.request.Request(
        f"{base_url}/{agent}/tasks/send",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {github_token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read())
    return body["task"]["id"]


def _poll_task(base_url: str, agent: str, task_id: str) -> dict:
    import urllib.request

    url = f"{base_url}/{agent}/tasks/{task_id}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _write_result(record: dict) -> None:
    _OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with _OUTPUT.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    logger.info("  → written to %s", _OUTPUT)


def _verify_agent(base_url: str, agent: str, github_token: str) -> bool:
    """Run one agent check.

    Returns:
        ``True`` on success, ``False`` on timeout or failure.
    """
    logger.info("[%s] Sending task...", agent)
    started_at = datetime.now(timezone.utc).isoformat()

    try:
        task_id = _send_task(base_url, agent, github_token)
    except Exception as exc:
        record = {
            "agent": agent,
            "status": "error",
            "error": str(exc),
            "started_at": started_at,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
        _write_result(record)
        logger.error("  failed to send task: %s", exc)
        return False

    logger.info("  task_id=%s", task_id)
    deadline = time.monotonic() + _TIMEOUT_S

    while time.monotonic() < deadline:
        try:
            task = _poll_task(base_url, agent, task_id)
        except Exception as exc:
            logger.warning("  poll error: %s", exc)
            time.sleep(_POLL_INTERVAL_S)
            continue

        status = task.get("status")
        logger.info("  status=%s", status)

        if status == "completed":
            record = {
                "agent": agent,
                "status": "completed",
                "task_id": task_id,
                "started_at": started_at,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "message": task.get("message"),
            }
            _write_result(record)
            return True

        if status == "failed":
            record = {
                "agent": agent,
                "status": "failed",
                "task_id": task_id,
                "started_at": started_at,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "error": task.get("error"),
            }
            _write_result(record)
            logger.error("  FAILED: %s", task.get("error"))
            return False

        time.sleep(_POLL_INTERVAL_S)

    # Timeout
    record = {
        "agent": agent,
        "status": "timeout",
        "task_id": task_id,
        "started_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "timeout_seconds": _TIMEOUT_S,
    }
    _write_result(record)
    logger.error(
        "  TIMEOUT after %ds — stopping as per plan stop condition.", _TIMEOUT_S
    )
    return False


def main() -> None:
    setup_logging()
    github_token = _require_env("GITHUB_TOKEN")
    base_url = os.environ.get(
        "CODE_REVIEW_AGENT_BASE_URL", "http://localhost:8000"
    ).rstrip("/")

    logger.info("Verifying A2A API at %s", base_url)
    logger.info("Target PR: %s/%s#%d", _OWNER, _REPO, _PR_NUMBER)
    logger.info("Timeout: %ds per agent", _TIMEOUT_S)

    for agent in _AGENTS:
        success = _verify_agent(base_url, agent, github_token)
        if not success:
            logger.error(
                "Stop condition met for [%s]: timeout or failure. "
                "Halting verification.",
                agent,
            )
            sys.exit(1)

    logger.info("All agents verified successfully.")


if __name__ == "__main__":
    main()
