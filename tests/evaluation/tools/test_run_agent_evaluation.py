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

import logging
import threading
import time

from tests.evaluation.conftest import load_eval_tool_module

run_agent_evaluation = load_eval_tool_module(
    "run_agent_evaluation", "run_agent_evaluation.py"
)


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
            "pr_number": 1,
            "model_id": "m",
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
        assert [endpoint for endpoint, _ in calls] == [
            "http://x/orchestrator",
            "http://x/orchestrator",
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
