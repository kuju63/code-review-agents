"""Tests for the shard-execution support added to run_agent_evaluation.py.

Covers `_select_shard` (positional round-robin partitioning),
`_validate_shard_args` (CLI argument sanity checks), `_failed_ids_path`
(sidecar naming), `_write_predictions_and_sidecar` (always-on failed-ids
sidecar output), `_maybe_generate_report` (report subprocess is skipped
during a sharded run and invoked for a normal run), and `main()`'s
shutdown-skip behavior during a sharded run. See
docs/eval-sharded-execution-spec.md for the design rationale.
"""

from __future__ import annotations

import argparse
import json

import pytest

from tests.evaluation.conftest import load_eval_tool_module

run_agent_evaluation = load_eval_tool_module(
    "run_agent_evaluation", "run_agent_evaluation.py"
)


class TestSelectShard:
    def test_single_shard_returns_all_items(self):
        items = [{"id": f"item-{i}"} for i in range(5)]
        result = run_agent_evaluation._select_shard(items, shard_index=0, shard_count=1)
        assert result == items

    def test_round_robin_partition_across_shards(self):
        items = [{"id": f"item-{i}"} for i in range(7)]
        shard0 = run_agent_evaluation._select_shard(items, 0, 3)
        shard1 = run_agent_evaluation._select_shard(items, 1, 3)
        shard2 = run_agent_evaluation._select_shard(items, 2, 3)

        assert [i["id"] for i in shard0] == ["item-0", "item-3", "item-6"]
        assert [i["id"] for i in shard1] == ["item-1", "item-4"]
        assert [i["id"] for i in shard2] == ["item-2", "item-5"]

    def test_all_shards_recombine_to_original_set_with_no_overlap(self):
        items = [{"id": f"item-{i}"} for i in range(11)]
        shard_count = 4
        recombined: list[dict] = []
        for idx in range(shard_count):
            recombined.extend(
                run_agent_evaluation._select_shard(items, idx, shard_count)
            )

        assert sorted(i["id"] for i in recombined) == sorted(i["id"] for i in items)
        assert len(recombined) == len(items)


class TestValidateShardArgs:
    def test_both_none_is_valid_non_sharded_run(self):
        run_agent_evaluation._validate_shard_args(None, None)

    def test_valid_shard_index_and_count_passes(self):
        run_agent_evaluation._validate_shard_args(0, 4)
        run_agent_evaluation._validate_shard_args(3, 4)

    def test_only_shard_index_set_raises(self):
        with pytest.raises(ValueError):
            run_agent_evaluation._validate_shard_args(0, None)

    def test_only_shard_count_set_raises(self):
        with pytest.raises(ValueError):
            run_agent_evaluation._validate_shard_args(None, 4)

    def test_shard_index_out_of_range_raises(self):
        with pytest.raises(ValueError):
            run_agent_evaluation._validate_shard_args(4, 4)

    def test_negative_shard_index_raises(self):
        with pytest.raises(ValueError):
            run_agent_evaluation._validate_shard_args(-1, 4)

    def test_shard_count_below_one_raises(self):
        with pytest.raises(ValueError):
            run_agent_evaluation._validate_shard_args(0, 0)


class TestIsSharded:
    def test_false_when_shard_count_unset(self):
        args = argparse.Namespace(shard_count=None)
        assert run_agent_evaluation._is_sharded(args) is False

    def test_true_when_shard_count_set(self):
        args = argparse.Namespace(shard_count=4)
        assert run_agent_evaluation._is_sharded(args) is True


class TestFailedIdsPath:
    def test_derives_sidecar_path_from_pred_stem(self):
        path = run_agent_evaluation._failed_ids_path(
            "evaluation/data/agent_predictions.jsonl"
        )
        assert str(path) == "evaluation/data/agent_predictions.failed_ids.json"


class TestWritePredictionsAndSidecar:
    def test_writes_predictions_and_empty_failed_ids_sidecar(self, tmp_path):
        output = tmp_path / "agent_predictions.jsonl"
        predictions = [{"id": "pr1", "agent_findings": []}]

        run_agent_evaluation._write_predictions_and_sidecar(
            str(output), predictions, []
        )

        lines = output.read_text(encoding="utf-8").splitlines()
        assert json.loads(lines[0]) == predictions[0]
        sidecar = tmp_path / "agent_predictions.failed_ids.json"
        assert json.loads(sidecar.read_text(encoding="utf-8")) == []

    def test_writes_non_empty_failed_ids_sidecar(self, tmp_path):
        output = tmp_path / "agent_predictions.jsonl"

        run_agent_evaluation._write_predictions_and_sidecar(
            str(output), [], ["pr1", "pr2"]
        )

        sidecar = tmp_path / "agent_predictions.failed_ids.json"
        assert json.loads(sidecar.read_text(encoding="utf-8")) == ["pr1", "pr2"]

    def test_creates_parent_directories(self, tmp_path):
        output = tmp_path / "nested" / "dir" / "agent_predictions.jsonl"

        run_agent_evaluation._write_predictions_and_sidecar(str(output), [], [])

        assert output.exists()


class TestMaybeGenerateReport:
    def test_sharded_run_skips_report_subprocess(self, monkeypatch):
        called = []
        monkeypatch.setattr(
            run_agent_evaluation.subprocess,
            "run",
            lambda *a, **k: called.append((a, k)),
        )
        args = argparse.Namespace(
            gold="g.jsonl", seeded="s.jsonl", output="o.jsonl", shard_count=4
        )

        result = run_agent_evaluation._maybe_generate_report(args)

        assert result is None
        assert called == []

    def test_non_sharded_run_invokes_report_subprocess(self, monkeypatch):
        called = []

        class FakeResult:
            returncode = 0

        def fake_run(cmd, *a, **k):
            called.append(cmd)
            return FakeResult()

        monkeypatch.setattr(run_agent_evaluation.subprocess, "run", fake_run)
        args = argparse.Namespace(
            gold="g.jsonl", seeded="s.jsonl", output="o.jsonl", shard_count=None
        )

        result = run_agent_evaluation._maybe_generate_report(args)

        assert result == 0
        assert len(called) == 1
        cmd = called[0]
        assert "generate_evaluation_report.py" in cmd[1]
        assert "--gold" in cmd and "g.jsonl" in cmd
        assert "--seeded" in cmd and "s.jsonl" in cmd
        assert "--pred" in cmd and "o.jsonl" in cmd

    def test_non_sharded_run_propagates_nonzero_exit_code(self, monkeypatch):
        class FakeResult:
            returncode = 1

        monkeypatch.setattr(
            run_agent_evaluation.subprocess, "run", lambda *a, **k: FakeResult()
        )
        args = argparse.Namespace(
            gold="g.jsonl", seeded="s.jsonl", output="o.jsonl", shard_count=None
        )

        assert run_agent_evaluation._maybe_generate_report(args) == 1


class TestMainShutdownSkip:
    def test_shutdown_called_for_non_sharded_run(self, monkeypatch):
        shutdown_calls = []
        monkeypatch.setattr(run_agent_evaluation, "_run_evaluation", lambda args: 0)
        monkeypatch.setattr(
            run_agent_evaluation,
            "_shutdown_server",
            lambda pid_file: shutdown_calls.append(pid_file),
        )
        monkeypatch.setattr(
            "sys.argv",
            [
                "run_agent_evaluation.py",
                "--gold",
                "g.jsonl",
                "--seeded",
                "s.jsonl",
                "--output",
                "o.jsonl",
                "--server-pid-file",
                "/tmp/pid",
            ],
        )

        run_agent_evaluation.main()

        assert shutdown_calls == ["/tmp/pid"]

    def test_shutdown_skipped_for_sharded_run(self, monkeypatch):
        shutdown_calls = []
        monkeypatch.setattr(run_agent_evaluation, "_run_evaluation", lambda args: 0)
        monkeypatch.setattr(
            run_agent_evaluation,
            "_shutdown_server",
            lambda pid_file: shutdown_calls.append(pid_file),
        )
        monkeypatch.setattr(
            "sys.argv",
            [
                "run_agent_evaluation.py",
                "--gold",
                "g.jsonl",
                "--seeded",
                "s.jsonl",
                "--output",
                "o.jsonl",
                "--server-pid-file",
                "/tmp/pid",
                "--shard-index",
                "0",
                "--shard-count",
                "4",
            ],
        )

        run_agent_evaluation.main()

        assert shutdown_calls == []

    def test_invalid_shard_args_returns_fatal_exit_code(self, monkeypatch):
        """Invalid --shard-index/--shard-count must be reported as one of the
        script's established fatal exit codes, not an uncaught ValueError
        (which would print a raw traceback and exit 1, indistinguishable
        from an unrelated crash)."""
        monkeypatch.setattr(
            "sys.argv",
            [
                "run_agent_evaluation.py",
                "--gold",
                "g.jsonl",
                "--seeded",
                "s.jsonl",
                "--output",
                "o.jsonl",
                "--shard-index",
                "5",
                "--shard-count",
                "4",
            ],
        )

        assert run_agent_evaluation.main() == 2

    def test_shutdown_still_runs_when_both_shard_args_given_but_out_of_range(
        self, monkeypatch
    ):
        """Regression: --shard-index 5 --shard-count 4 leaves
        args.shard_count set (not None), so a naive `_is_sharded(args)`
        check in the finally block would treat this failed-validation
        invocation as a real sharded run and skip shutdown -- even though
        _run_evaluation() never ran and this invocation is not actually
        part of a valid shard sequence. Shutdown must still fire."""
        shutdown_calls = []
        monkeypatch.setattr(
            run_agent_evaluation,
            "_shutdown_server",
            lambda pid_file: shutdown_calls.append(pid_file),
        )
        monkeypatch.setattr(
            "sys.argv",
            [
                "run_agent_evaluation.py",
                "--gold",
                "g.jsonl",
                "--seeded",
                "s.jsonl",
                "--output",
                "o.jsonl",
                "--server-pid-file",
                "/tmp/pid",
                "--shard-index",
                "5",
                "--shard-count",
                "4",
            ],
        )

        exit_code = run_agent_evaluation.main()

        assert exit_code == 2
        assert shutdown_calls == ["/tmp/pid"]

    def test_shutdown_still_runs_when_shard_args_are_invalid_and_shard_count_unset(
        self, monkeypatch
    ):
        """Regression: --shard-index without --shard-count leaves
        args.shard_count as None, which is exactly the condition under which
        the non-sharded finally-block branch shuts the server down. That
        must still happen even though _validate_shard_args() raises for this
        combination -- an operator's typo shouldn't leak a running A2A
        server."""
        shutdown_calls = []
        monkeypatch.setattr(
            run_agent_evaluation,
            "_shutdown_server",
            lambda pid_file: shutdown_calls.append(pid_file),
        )
        monkeypatch.setattr(
            "sys.argv",
            [
                "run_agent_evaluation.py",
                "--gold",
                "g.jsonl",
                "--seeded",
                "s.jsonl",
                "--output",
                "o.jsonl",
                "--server-pid-file",
                "/tmp/pid",
                "--shard-index",
                "0",
            ],
        )

        exit_code = run_agent_evaluation.main()

        assert exit_code == 2
        assert shutdown_calls == ["/tmp/pid"]
