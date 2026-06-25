"""Shared A2A HTTP client helpers for evaluation scripts.

Both run_agent_evaluation.py and measure_pr_info_response.py use the same
A2A task protocol (send → poll → data). This module centralises that logic so
protocol changes (payload keys, status values, URL patterns) only need one fix.
"""

from __future__ import annotations

import time
from typing import Any

import httpx


def a2a_send(
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


def a2a_poll(
    client: httpx.Client,
    endpoint: str,
    task_id: str,
    poll_interval: float = 3,
    timeout: float = 1800,
    verbose: bool = False,
) -> dict[str, Any]:
    """Poll until the task completes. Return the data part or raise on failure/timeout."""
    deadline = time.monotonic() + timeout
    while True:
        resp = client.get(f"{endpoint}/tasks/{task_id}", timeout=10)
        resp.raise_for_status()
        task = resp.json()
        status = task["status"]
        if status == "completed":
            for part in task.get("message", {}).get("parts", []):
                if part.get("kind") == "data":
                    return part["data"]
            raise RuntimeError(f"Task {task_id} completed but has no data part")
        if status == "failed":
            raise RuntimeError(f"Task {task_id} failed: {task.get('error', '?')}")
        if time.monotonic() > deadline:
            raise TimeoutError(
                f"Task {task_id} timed out after {timeout}s (status={status})"
            )
        if verbose:
            print(f"  [{status}] polling...", flush=True)
        time.sleep(poll_interval)
