"""Discord Webhook notification for evaluation pipeline completion.

Fires once per run_agent_evaluation.py invocation, right after the report is
written. Notification is opt-in (skipped when DISCORD_WEBHOOK_URL is unset)
and best-effort: any failure is logged as a warning and never propagates, so
a broken webhook can't fail an evaluation run that took a long time to
produce its result.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

_COLOR_PASS = 0x2ECC71
_COLOR_FAIL = 0xE74C3C


def build_notification_payload(
    scores: dict[str, Any],
    failed_ids: list[str],
    report_path: str | Path,
    commit_hash: str,
    model_id: str,
    executed_at: str,
) -> dict[str, Any]:
    """Build a Discord Webhook embed payload summarizing an evaluation run."""
    g = scores["gold"]
    s = scores["seeded"]

    critical_miss_ok = s["critical_miss_rate"] == 0.0
    must_find_ok = s["must_find_recall"] >= 0.95
    hard_gate_pass = critical_miss_ok and must_find_ok

    fields = [
        {
            "name": "Hard Gate",
            "value": "PASS ✅" if hard_gate_pass else "FAIL ❌",
            "inline": True,
        },
        {"name": "Issue Recall", "value": f"{g['issue_recall']:.3f}", "inline": True},
        {
            "name": "Issue Precision",
            "value": f"{g['issue_precision']:.3f}",
            "inline": True,
        },
        {
            "name": "Must-Find Recall",
            "value": f"{s['must_find_recall']:.3f}",
            "inline": True,
        },
        {
            "name": "Critical Miss Rate",
            "value": f"{s['critical_miss_rate']:.3f}",
            "inline": True,
        },
        {"name": "失敗アイテム数", "value": str(len(failed_ids)), "inline": True},
        {"name": "Commit", "value": f"`{commit_hash}`", "inline": True},
        {"name": "Model", "value": f"`{model_id}`", "inline": True},
    ]

    return {
        "embeds": [
            {
                "title": "評価パイプライン完了",
                "description": f"Report: `{Path(report_path).name}`",
                "color": _COLOR_PASS if hard_gate_pass else _COLOR_FAIL,
                "fields": fields,
                "timestamp": executed_at,
            }
        ]
    }


def send_discord_notification(webhook_url: str | None, payload: dict[str, Any]) -> None:
    """POST *payload* to the Discord webhook. No-ops when *webhook_url* is unset.

    Never raises: failures are logged as warnings so they can't fail an
    evaluation run whose actual result already succeeded or failed on its
    own merits.
    """
    if not webhook_url:
        return
    try:
        response = httpx.post(webhook_url, json=payload, timeout=10)
        response.raise_for_status()
    except Exception as exc:
        # httpx exceptions (e.g. HTTPStatusError.raise_for_status()) often embed
        # the request URL in their message, and a Discord webhook URL carries an
        # auth token in its path — redact it so it never lands in logs.
        message = str(exc).replace(webhook_url, "<redacted webhook url>")
        logging.warning("Discord notification failed: %s", message)
