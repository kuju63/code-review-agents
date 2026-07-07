"""Tests for the concurrency changes in evaluation/tools/run_agent_evaluation.py.

These tests exercise the new `_evaluate_concurrently` helper (used to run
Gold/Seeded items with bounded parallelism instead of a strict sequential
for-loop) and the parallelized frontend/security reviewer calls inside
`evaluate_seeded_item`. No live A2A server or network access is used;
`evaluate_fn` / `_run_a2a` are replaced with lightweight fakes.
"""

from __future__ import annotations

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

    def test_failure_log_line_is_self_contained_under_concurrency(self, capsys):
        """Each outcome line must carry its own label so a WARN can't visually
        attach to a different, concurrently-running item's start marker."""
        items = [{"id": f"item-{i}"} for i in range(6)]

        def evaluate_fn(item):
            time.sleep(0.02)
            if item["id"] == "item-3":
                raise TimeoutError(
                    "Task deadbeef timed out after 1800s (status=working)"
                )
            return {"id": item["id"], "agent_findings": []}

        run_agent_evaluation._evaluate_concurrently(items, evaluate_fn, concurrency=6)

        out = capsys.readouterr().out
        lines = out.splitlines()

        warn_lines = [line for line in lines if "WARN" in line]
        assert len(warn_lines) == 1
        assert "item-3" in warn_lines[0]

        for item in items:
            started_lines = [line for line in lines if "started" in line]
            assert any(item["id"] in line for line in started_lines)

        done_lines = [line for line in lines if "done" in line]
        assert len(done_lines) == 5
        for item in items:
            if item["id"] == "item-3":
                continue
            assert any(item["id"] in line for line in done_lines)


class TestSeededItemReviewerParallelism:
    def test_frontend_and_security_reviewer_calls_overlap(self, monkeypatch):
        windows: dict[str, tuple[float, float]] = {}
        lock = threading.Lock()

        def fake_run_a2a(client, endpoint, data, poll_interval, timeout):
            name = endpoint.rsplit("/", 1)[-1]
            start = time.monotonic()
            time.sleep(0.05)
            end = time.monotonic()
            with lock:
                windows[name] = (start, end)
            if name == "pr-info-collector":
                return {"pr_info": {"file_changes": []}}
            return {"reviewer": name}

        monkeypatch.setattr(run_agent_evaluation, "_run_a2a", fake_run_a2a)
        monkeypatch.setattr(
            run_agent_evaluation,
            "_to_predictions",
            lambda data, pr_id: {"id": pr_id, "agent_findings": []},
        )

        item = {
            "id": "seeded-1",
            "repository": "a/b",
            "pr_number": 1,
            "file_changes": [],
        }
        run_agent_evaluation.evaluate_seeded_item(
            item,
            client=object(),
            base_url="http://x",
            poll_interval=0.01,
            timeout=5,
            model_id="m",
        )

        f_start, f_end = windows["frontend-reviewer"]
        s_start, s_end = windows["security-reviewer"]
        overlap = min(f_end, s_end) - max(f_start, s_start)
        assert overlap > 0
