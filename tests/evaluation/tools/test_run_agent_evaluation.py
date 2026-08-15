"""Tests for evaluation/tools/run_agent_evaluation.py.

These tests exercise the `_evaluate_concurrently` helper (used to run
Gold/Seeded items with bounded parallelism instead of a strict sequential
for-loop) and `evaluate_item`, the single function used to evaluate both
Gold and Seeded items via the `/orchestrator` endpoint (Issue #237 merged
the former `evaluate_gold_item`/`evaluate_seeded_item` split, since Seeded
items are real PRs in dedicated seed repositories and no longer need
client-side stack-label routing or file_changes overlay -- see
docs/eval-seeded-orchestrator-unification-spec.md). No live A2A server or
network access is used; `evaluate_fn` / `_run_a2a` are replaced with
lightweight fakes.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request

from tests.evaluation.conftest import load_eval_tool_module

run_agent_evaluation = load_eval_tool_module(
    "run_agent_evaluation", "run_agent_evaluation.py"
)
measure_pr_info_response = load_eval_tool_module(
    "measure_pr_info_response", "measure_pr_info_response.py"
)
verify_a2a_api = load_eval_tool_module("verify_a2a_api", "verify_a2a_api.py")


class TestEvaluateConcurrentlyOrdering:
    def test_predictions_preserve_input_order_regardless_of_completion_order(self):
        items = [{"id": f"item-{i}"} for i in range(4)]
        delays = {"item-0": 0.12, "item-1": 0.05, "item-2": 0.03, "item-3": 0.0}

        def evaluate_fn(item):
            time.sleep(delays[item["id"]])
            return {"id": item["id"], "agent_findings": []}

        predictions, failed = run_agent_evaluation._evaluate_concurrently(
            items, evaluate_fn, concurrency=4
        )

        assert [p["id"] for p in predictions] == [
            "item-0",
            "item-1",
            "item-2",
            "item-3",
        ]
        assert failed == []


class TestEvaluateConcurrentlyBoundedParallelism:
    def test_never_exceeds_requested_concurrency(self):
        items = [{"id": f"item-{i}"} for i in range(6)]
        active = 0
        max_active = 0
        lock = threading.Lock()

        def evaluate_fn(item):
            nonlocal active, max_active
            with lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            return {"id": item["id"], "agent_findings": []}

        predictions, failed = run_agent_evaluation._evaluate_concurrently(
            items, evaluate_fn, concurrency=2
        )

        assert max_active <= 2
        assert len(predictions) == 6
        assert failed == []

    def test_actually_runs_items_in_parallel_not_just_sequentially(self):
        items = [{"id": f"item-{i}"} for i in range(4)]
        active = 0
        max_active = 0
        lock = threading.Lock()

        def evaluate_fn(item):
            nonlocal active, max_active
            with lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            return {"id": item["id"], "agent_findings": []}

        run_agent_evaluation._evaluate_concurrently(items, evaluate_fn, concurrency=2)

        assert max_active >= 2


class TestEvaluateConcurrentlyFailureIsolation:
    def test_failed_items_are_recorded_and_do_not_affect_others(self):
        items = [{"id": f"item-{i}"} for i in range(4)]

        def evaluate_fn(item):
            if item["id"] == "item-2":
                raise RuntimeError("boom")
            return {"id": item["id"], "agent_findings": []}

        predictions, failed = run_agent_evaluation._evaluate_concurrently(
            items, evaluate_fn, concurrency=2
        )

        assert failed == ["item-2"]
        assert [p["id"] for p in predictions] == ["item-0", "item-1", "item-3"]

    def test_failure_log_line_is_self_contained_under_concurrency(self, caplog):
        """Each outcome record must carry its own label so a WARNING can't
        visually attach to a different, concurrently-running item's start
        marker."""
        caplog.set_level(logging.INFO)
        items = [{"id": f"item-{i}"} for i in range(6)]

        def evaluate_fn(item):
            time.sleep(0.02)
            if item["id"] == "item-3":
                raise TimeoutError(
                    "Task deadbeef timed out after 1800s (status=working)"
                )
            return {"id": item["id"], "agent_findings": []}

        run_agent_evaluation._evaluate_concurrently(items, evaluate_fn, concurrency=6)

        records = caplog.records

        warn_records = [r for r in records if r.levelno == logging.WARNING]
        assert len(warn_records) == 1
        assert "item-3" in warn_records[0].getMessage()

        started_records = [r for r in records if "started" in r.getMessage()]
        for item in items:
            assert any(item["id"] in r.getMessage() for r in started_records)

        done_records = [
            r for r in records if r.levelno == logging.INFO and "done" in r.getMessage()
        ]
        assert len(done_records) == 5
        for item in items:
            if item["id"] == "item-3":
                continue
            assert any(item["id"] in r.getMessage() for r in done_records)


class TestEvaluateItem:
    """evaluate_item is the single function used to evaluate both Gold and
    Seeded items (Issue #237): it always POSTs to /orchestrator and lets
    the server's own detect_project_types select reviewers, instead of the
    former client-side stack-label routing that only applied to Seeded
    items.
    """

    def _run_a2a_capture(self, calls: list[tuple[str, dict]]):
        def fake_run_a2a(client, endpoint, data, poll_interval, timeout):
            calls.append((endpoint, data))
            return {"lead_report": "data"}

        return fake_run_a2a

    def test_calls_orchestrator_exactly_once_with_expected_payload(self, monkeypatch):
        calls: list[tuple[str, dict]] = []
        monkeypatch.setattr(
            run_agent_evaluation, "_run_a2a", self._run_a2a_capture(calls)
        )
        monkeypatch.setattr(
            run_agent_evaluation,
            "_to_predictions",
            lambda data, pr_id: {"id": pr_id, "agent_findings": []},
        )

        item = {"id": "owner/repo#1", "repository": "owner/repo", "pr_number": 1}
        run_agent_evaluation.evaluate_item(
            item,
            client=object(),
            base_url="http://x",
            poll_interval=0.01,
            timeout=5,
            model_id="m",
        )

        assert len(calls) == 1
        endpoint, data = calls[0]
        assert endpoint == "http://x/orchestrator"
        assert data == {
            "owner": "owner",
            "repo": "repo",
            "prNumber": 1,
            "modelId": "m",
        }

    def test_passes_item_id_through_to_to_predictions(self, monkeypatch):
        monkeypatch.setattr(run_agent_evaluation, "_run_a2a", self._run_a2a_capture([]))
        captured: dict[str, str] = {}

        def fake_to_predictions(data, pr_id):
            captured["pr_id"] = pr_id
            return {"id": pr_id, "agent_findings": []}

        monkeypatch.setattr(
            run_agent_evaluation, "_to_predictions", fake_to_predictions
        )

        item = {
            "id": "seeded::kuju63/vue-seeded#13",
            "repository": "kuju63/vue-seeded",
            "pr_number": 13,
        }
        run_agent_evaluation.evaluate_item(
            item,
            client=object(),
            base_url="http://x",
            poll_interval=0.01,
            timeout=5,
            model_id="m",
        )

        assert captured["pr_id"] == "seeded::kuju63/vue-seeded#13"

    def test_gold_shaped_and_seeded_shaped_items_both_succeed(self, monkeypatch):
        calls: list[tuple[str, dict]] = []
        monkeypatch.setattr(
            run_agent_evaluation, "_run_a2a", self._run_a2a_capture(calls)
        )
        monkeypatch.setattr(
            run_agent_evaluation,
            "_to_predictions",
            lambda data, pr_id: {"id": pr_id, "agent_findings": []},
        )

        gold_item = {"id": "owner/repo#1", "repository": "owner/repo", "pr_number": 1}
        seeded_item = {
            "id": "seeded::kuju63/react-seeded#5",
            "repository": "kuju63/react-seeded",
            "pr_number": 5,
            "stack": "react",
            "file_changes": [{"path": "src/decoy.ts", "patch": "decoy patch"}],
        }

        result_gold = run_agent_evaluation.evaluate_item(
            gold_item,
            client=object(),
            base_url="http://x",
            poll_interval=0.01,
            timeout=5,
            model_id="m",
        )
        result_seeded = run_agent_evaluation.evaluate_item(
            seeded_item,
            client=object(),
            base_url="http://x",
            poll_interval=0.01,
            timeout=5,
            model_id="m",
        )

        assert result_gold["id"] == "owner/repo#1"
        assert result_seeded["id"] == "seeded::kuju63/react-seeded#5"
        # Both payloads must be endpoint + {owner, repo, prNumber, modelId}
        # only -- asserting full equality (not just the endpoint) guards
        # against `stack`/`file_changes` leaking back into the request if
        # someone reintroduces per-item branching later.
        assert calls == [
            (
                "http://x/orchestrator",
                {
                    "owner": "owner",
                    "repo": "repo",
                    "prNumber": 1,
                    "modelId": "m",
                },
            ),
            (
                "http://x/orchestrator",
                {
                    "owner": "kuju63",
                    "repo": "react-seeded",
                    "prNumber": 5,
                    "modelId": "m",
                },
            ),
        ]

    def test_unknown_or_missing_stack_does_not_raise(self, monkeypatch):
        """Regression guard for Issue #237: stack-label fail-closed
        validation was removed along with the client-side routing it
        guarded. An unrecognized or absent stack must no longer raise --
        /orchestrator's own detect_project_types decides reviewer
        selection, and evaluate_item does not inspect `stack` at all.
        """
        calls: list[tuple[str, dict]] = []
        monkeypatch.setattr(
            run_agent_evaluation, "_run_a2a", self._run_a2a_capture(calls)
        )
        monkeypatch.setattr(
            run_agent_evaluation,
            "_to_predictions",
            lambda data, pr_id: {"id": pr_id, "agent_findings": []},
        )

        item_unknown_stack = {
            "id": "seeded::a/b#1",
            "repository": "a/b",
            "pr_number": 1,
            "stack": "solid",
        }
        item_missing_stack = {
            "id": "seeded::a/b#2",
            "repository": "a/b",
            "pr_number": 2,
        }

        run_agent_evaluation.evaluate_item(
            item_unknown_stack,
            client=object(),
            base_url="http://x",
            poll_interval=0.01,
            timeout=5,
            model_id="m",
        )
        run_agent_evaluation.evaluate_item(
            item_missing_stack,
            client=object(),
            base_url="http://x",
            poll_interval=0.01,
            timeout=5,
            model_id="m",
        )

        assert len(calls) == 2


class TestCamelCaseA2AContract:
    def test_converts_camel_case_orchestrator_response_to_predictions(self):
        lead_report = {
            "overallSummary": "One accepted finding",
            "decisions": [
                {
                    "reviewerId": "security-reviewer",
                    "perspective": "security",
                    "finding": {
                        "filePath": "src/auth.ts",
                        "line": 42,
                        "comment": "Validate the redirect target",
                        "context": "Open redirects enable phishing",
                        "proposedFix": "Allow only local paths",
                        "priority": "high",
                    },
                    "verdict": "accept",
                    "reason": "The redirect is attacker-controlled",
                    "impact": "Account compromise",
                    "severity": "high",
                    "impactCategory": "security",
                    "finalPriority": "high",
                }
            ],
            "reviewerErrors": [],
        }

        assert run_agent_evaluation._to_predictions(lead_report, "owner/repo#1") == {
            "id": "owner/repo#1",
            "agent_findings": [
                {
                    "path": "src/auth.ts",
                    "line": 42,
                    "category": "security",
                    "severity": "high",
                    "impact": "security",
                    "priority": "high",
                    "summary": "Validate the redirect target",
                }
            ],
            "lead_decisions": [
                {"path": "src/auth.ts", "line": 42, "decision": "accept"}
            ],
        }

    def test_measures_camel_case_pr_info_response(self):
        result = {
            "repositoryInfo": {"owner": "owner", "repository": "repo"},
            "projectSummary": "TypeScript project",
            "prInfo": {
                "title": "Example",
                "prNumber": 1,
                "body": "Pull request body",
                "labels": [],
                "fileChanges": [{"filePath": "src/index.ts", "patch": None}],
            },
            "dependencyFiles": ["package.json"],
            "manifestContents": {},
        }

        metrics = measure_pr_info_response._measure(result, None)

        assert metrics["file_changes_count"] == 1
        assert metrics["project_summary_bytes"] == len("TypeScript project")
        assert metrics["body_bytes"] == len("Pull request body")
        assert metrics["dependency_files"] == ["package.json"]
        assert metrics["file_details"] == [("src/index.ts", 0)]

    def test_verify_script_sends_camel_case_pr_number(self, monkeypatch):
        captured = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def read(self):
                return b'{"task":{"id":"task-1"}}'

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse()

        monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

        task_id = verify_a2a_api._send_task("http://x", "orchestrator", "token")
        payload = json.loads(captured["request"].data)

        assert task_id == "task-1"
        assert payload["message"]["parts"][0]["data"] == {
            "owner": verify_a2a_api._OWNER,
            "repo": verify_a2a_api._REPO,
            "prNumber": verify_a2a_api._PR_NUMBER,
        }
