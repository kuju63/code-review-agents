"""Tests for the concurrency changes in evaluation/tools/run_agent_evaluation.py.

These tests exercise the new `_evaluate_concurrently` helper (used to run
Gold/Seeded items with bounded parallelism instead of a strict sequential
for-loop) and the parallelized technical/security reviewer calls inside
`evaluate_seeded_item`. No live A2A server or network access is used;
`evaluate_fn` / `_run_a2a` are replaced with lightweight fakes.
"""

from __future__ import annotations

import logging
import threading
import time

import pytest

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


class TestSeededItemReviewerParallelism:
    def test_technical_and_security_reviewer_calls_overlap(self, monkeypatch):
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
            "stack": "react",
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

        f_start, f_end = windows["react-reviewer"]
        s_start, s_end = windows["security-reviewer"]
        overlap = min(f_end, s_end) - max(f_start, s_start)
        assert overlap > 0

    def test_file_changes_not_overridden_by_seeded_item(self, monkeypatch):
        """evaluate_seeded_item passes pr-info-collector's file_changes through
        unmodified; a Seeded item's own file_changes key (a leftover, purely
        informational field from dataset generation) must not overlay it.
        Unlike the retired mutation-injection pipeline, the Seeded item's PR
        is real, so pr-info-collector's response already reflects the actual
        diff.
        """
        real_file_changes = [{"filePath": "src/real.ts", "patch": "real patch"}]
        seen_payloads: dict[str, dict] = {}

        def fake_run_a2a(client, endpoint, data, poll_interval, timeout):
            name = endpoint.rsplit("/", 1)[-1]
            if name == "pr-info-collector":
                # A copy, not the same object as real_file_changes: if
                # evaluate_seeded_item ever mutated the list in place, the
                # assertion below would otherwise trivially still pass
                # (comparing the same object to itself).
                return {"pr_info": {"file_changes": list(real_file_changes)}}
            seen_payloads[name] = data
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
            "stack": "react",
            "file_changes": [{"path": "src/decoy.ts", "patch": "decoy patch"}],
        }
        run_agent_evaluation.evaluate_seeded_item(
            item,
            client=object(),
            base_url="http://x",
            poll_interval=0.01,
            timeout=5,
            model_id="m",
        )

        for reviewer_name in ("react-reviewer", "security-reviewer"):
            assert (
                seen_payloads[reviewer_name]["pr_info"]["pr_info"]["file_changes"]
                == real_file_changes
            )


class TestEvaluateSeededItemStackRouting:
    """evaluate_seeded_item routes the technical reviewer call by stack
    (Issue #181): each Seeded item is reviewed by the reviewer matching its
    own stack plus SecurityReviewer, instead of always calling the (formerly
    React-only) Frontend reviewer regardless of the item's actual stack.
    """

    def _run(self, monkeypatch, stack: str) -> list[str]:
        called_endpoints: list[str] = []

        def fake_run_a2a(client, endpoint, data, poll_interval, timeout):
            name = endpoint.rsplit("/", 1)[-1]
            called_endpoints.append(name)
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
            "stack": stack,
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
        return called_endpoints

    def test_react_stack_calls_react_reviewer(self, monkeypatch):
        called = self._run(monkeypatch, "react")
        assert set(called) == {
            "pr-info-collector",
            "react-reviewer",
            "security-reviewer",
            "lead-engineer",
        }

    def test_vue_stack_calls_vue_reviewer(self, monkeypatch):
        called = self._run(monkeypatch, "vue")
        assert set(called) == {
            "pr-info-collector",
            "vue-reviewer",
            "security-reviewer",
            "lead-engineer",
        }

    def test_angular_stack_calls_angular_reviewer(self, monkeypatch):
        called = self._run(monkeypatch, "angular")
        assert set(called) == {
            "pr-info-collector",
            "angular-reviewer",
            "security-reviewer",
            "lead-engineer",
        }

    def test_svelte_stack_calls_svelte_reviewer(self, monkeypatch):
        called = self._run(monkeypatch, "svelte")
        assert set(called) == {
            "pr-info-collector",
            "svelte-reviewer",
            "security-reviewer",
            "lead-engineer",
        }

    def test_unknown_stack_raises_value_error_without_calling_any_reviewer(
        self, monkeypatch
    ):
        called_endpoints: list[str] = []

        def fake_run_a2a(client, endpoint, data, poll_interval, timeout):
            called_endpoints.append(endpoint.rsplit("/", 1)[-1])
            return {"pr_info": {"file_changes": []}}

        monkeypatch.setattr(run_agent_evaluation, "_run_a2a", fake_run_a2a)

        item = {
            "id": "seeded-1",
            "repository": "a/b",
            "pr_number": 1,
            "stack": "solid",
            "file_changes": [],
        }

        with pytest.raises(ValueError, match="solid"):
            run_agent_evaluation.evaluate_seeded_item(
                item,
                client=object(),
                base_url="http://x",
                poll_interval=0.01,
                timeout=5,
                model_id="m",
            )
        # Fails closed before any A2A call is made, including
        # pr-info-collector -- no wasted work and no accidental fallback to
        # an unrelated reviewer.
        assert called_endpoints == []

    def test_missing_stack_key_raises_value_error_not_key_error(self, monkeypatch):
        called_endpoints: list[str] = []

        def fake_run_a2a(client, endpoint, data, poll_interval, timeout):
            called_endpoints.append(endpoint.rsplit("/", 1)[-1])
            return {"pr_info": {"file_changes": []}}

        monkeypatch.setattr(run_agent_evaluation, "_run_a2a", fake_run_a2a)

        item = {
            "id": "seeded-1",
            "repository": "a/b",
            "pr_number": 1,
            "file_changes": [],
        }

        with pytest.raises(ValueError, match="None"):
            run_agent_evaluation.evaluate_seeded_item(
                item,
                client=object(),
                base_url="http://x",
                poll_interval=0.01,
                timeout=5,
                model_id="m",
            )
        assert called_endpoints == []

    def test_none_stack_raises_value_error(self, monkeypatch):
        called_endpoints: list[str] = []

        def fake_run_a2a(client, endpoint, data, poll_interval, timeout):
            called_endpoints.append(endpoint.rsplit("/", 1)[-1])
            return {"pr_info": {"file_changes": []}}

        monkeypatch.setattr(run_agent_evaluation, "_run_a2a", fake_run_a2a)

        item = {
            "id": "seeded-1",
            "repository": "a/b",
            "pr_number": 1,
            "stack": None,
            "file_changes": [],
        }

        with pytest.raises(ValueError, match="None"):
            run_agent_evaluation.evaluate_seeded_item(
                item,
                client=object(),
                base_url="http://x",
                poll_interval=0.01,
                timeout=5,
                model_id="m",
            )
        assert called_endpoints == []

    def test_non_string_stack_raises_value_error(self, monkeypatch):
        called_endpoints: list[str] = []

        def fake_run_a2a(client, endpoint, data, poll_interval, timeout):
            called_endpoints.append(endpoint.rsplit("/", 1)[-1])
            return {"pr_info": {"file_changes": []}}

        monkeypatch.setattr(run_agent_evaluation, "_run_a2a", fake_run_a2a)

        item = {
            "id": "seeded-1",
            "repository": "a/b",
            "pr_number": 1,
            "stack": 42,
            "file_changes": [],
        }

        with pytest.raises(ValueError, match="42"):
            run_agent_evaluation.evaluate_seeded_item(
                item,
                client=object(),
                base_url="http://x",
                poll_interval=0.01,
                timeout=5,
                model_id="m",
            )
        assert called_endpoints == []


class TestTechnicalReviewerEndpoint:
    """Direct unit tests for the resolver used by evaluate_seeded_item."""

    def test_known_stacks_resolve(self):
        assert run_agent_evaluation._technical_reviewer_endpoint("react") == (
            "react-reviewer"
        )
        assert run_agent_evaluation._technical_reviewer_endpoint("vue") == (
            "vue-reviewer"
        )
        assert run_agent_evaluation._technical_reviewer_endpoint("angular") == (
            "angular-reviewer"
        )
        assert run_agent_evaluation._technical_reviewer_endpoint("svelte") == (
            "svelte-reviewer"
        )

    def test_none_raises_value_error(self):
        with pytest.raises(ValueError, match="None"):
            run_agent_evaluation._technical_reviewer_endpoint(None)

    def test_non_string_raises_value_error(self):
        with pytest.raises(ValueError, match="42"):
            run_agent_evaluation._technical_reviewer_endpoint(42)

    def test_unknown_string_raises_value_error(self):
        with pytest.raises(ValueError, match="solid"):
            run_agent_evaluation._technical_reviewer_endpoint("solid")
