"""Tests for evaluation/tools/build_gold_set.py."""

from __future__ import annotations

import json
from unittest.mock import patch

from tests.evaluation.conftest import load_eval_tool_module

build_gold_set = load_eval_tool_module("build_gold_set", "build_gold_set.py")

Target = build_gold_set.Target
build_gold_item = build_gold_set.build_gold_item
load_targets = build_gold_set.load_targets


def _api_payload(url: str, _token: str):
    if url.endswith("/files?per_page=100"):
        return [{"filename": "src/App.tsx", "patch": "@@ -1 +1 @@"}]
    if url.endswith("/comments?per_page=100"):
        return [
            {
                "body": "This can expose user data.",
                "path": "src/App.tsx",
                "line": 12,
                "html_url": "https://github.com/owner/repo/pull/1#discussion_r1",
            }
        ]
    return {"title": "PR", "body": "", "labels": [], "html_url": url}


class TestLoadTargets:
    def test_loads_three_axis_labels(self, tmp_path):
        path = tmp_path / "targets.json"
        path.write_text(
            json.dumps(
                [
                    {
                        "repository": "owner/repo",
                        "pr_number": 1,
                        "severity": "high",
                        "impact": "security",
                        "priority": "medium",
                    }
                ]
            )
        )

        assert load_targets(str(path)) == [
            Target(
                repository="owner/repo",
                pr_number=1,
                severity="high",
                impact="security",
                priority="medium",
            )
        ]

    def test_legacy_target_defaults_axes_to_unknown(self, tmp_path):
        path = tmp_path / "targets.json"
        path.write_text(json.dumps([{"repository": "owner/repo", "pr_number": 1}]))

        target = load_targets(str(path))[0]

        assert (target.severity, target.impact, target.priority) == (
            "unknown",
            "unknown",
            "unknown",
        )


class TestBuildGoldItem:
    @patch.object(build_gold_set, "_api_get", side_effect=_api_payload)
    def test_inherits_target_axes_to_every_finding(self, _api_get):
        target = Target(
            repository="owner/repo",
            pr_number=1,
            severity="critical",
            impact="security",
            priority="high",
        )

        item = build_gold_item(target, "token")

        assert item["human_findings"] == [
            {
                "category": "unknown",
                "severity": "critical",
                "impact": "security",
                "priority": "high",
                "path": "src/App.tsx",
                "line": 12,
                "summary": "This can expose user data.",
                "source": "https://github.com/owner/repo/pull/1#discussion_r1",
            }
        ]
