"""Tests for evaluation/tools/merge_predictions.py.

Merges multiple shard predictions.jsonl files (each produced by
run_agent_evaluation.py --shard-index/--shard-count) into one
agent_predictions.jsonl, using each shard's failed_ids.json sidecar to
distinguish a known per-item failure (safe, non-fatal) from an id that
never ran at all (unaccounted -- fatal by default, since it is the
signature of a shard killed mid-run by an external time limit). See
docs/eval-sharded-execution-spec.md §2.4 for the design rationale.
"""

from __future__ import annotations

import json

from tests.evaluation.conftest import load_eval_tool_module

merge_predictions = load_eval_tool_module("merge_predictions", "merge_predictions.py")


def write_jsonl(path, rows):
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
        if rows
        else "",
        encoding="utf-8",
    )


def write_sidecar(pred_path, failed_ids):
    sidecar = pred_path.with_name(pred_path.stem + ".failed_ids.json")
    sidecar.write_text(json.dumps(failed_ids), encoding="utf-8")


class TestMergeHappyPath:
    def test_merges_two_shards_in_original_gold_seeded_order(self, tmp_path):
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}, {"id": "g2"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [{"id": "s1"}])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g2", "agent_findings": []}])
        write_sidecar(shard0, [])
        shard1 = tmp_path / "shard1.jsonl"
        write_jsonl(
            shard1,
            [
                {"id": "g1", "agent_findings": []},
                {"id": "s1", "agent_findings": []},
            ],
        )
        write_sidecar(shard1, [])

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0), str(shard1)],
            allow_missing=False,
        )

        assert exit_code == 0
        merged_ids = [
            json.loads(line)["id"] for line in output.read_text().splitlines()
        ]
        assert merged_ids == ["g1", "g2", "s1"]

        merged_sidecar = json.loads((tmp_path / "merged.failed_ids.json").read_text())
        assert merged_sidecar == []


class TestMergeDuplicateIds:
    def test_duplicate_id_across_shards_is_fatal(self, tmp_path):
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g1", "agent_findings": []}])
        write_sidecar(shard0, [])
        shard1 = tmp_path / "shard1.jsonl"
        write_jsonl(shard1, [{"id": "g1", "agent_findings": []}])
        write_sidecar(shard1, [])

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0), str(shard1)],
            allow_missing=False,
        )

        assert exit_code == 2
        assert not output.exists()


class TestMergeUnaccountedIds:
    def test_unaccounted_id_is_fatal_by_default(self, tmp_path):
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}, {"id": "g2"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g1", "agent_findings": []}])
        write_sidecar(shard0, [])
        # shard1 was supposed to cover g2 but never ran (e.g. killed by an
        # external time limit): no predictions row, no sidecar entry.

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0)],
            allow_missing=False,
        )

        assert exit_code == 2
        assert not output.exists()

    def test_allow_missing_downgrades_unaccounted_id_to_warning(self, tmp_path, capsys):
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}, {"id": "g2"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g1", "agent_findings": []}])
        write_sidecar(shard0, [])

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0)],
            allow_missing=True,
        )

        assert exit_code == 1
        assert output.exists()
        merged_sidecar = json.loads((tmp_path / "merged.failed_ids.json").read_text())
        assert merged_sidecar == ["g2"]
        assert "g2" in capsys.readouterr().out

    def test_known_failed_id_is_not_fatal_without_allow_missing(self, tmp_path):
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}, {"id": "g2"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g1", "agent_findings": []}])
        write_sidecar(shard0, ["g2"])

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0)],
            allow_missing=False,
        )

        assert exit_code == 1
        merged_ids = [
            json.loads(line)["id"] for line in output.read_text().splitlines()
        ]
        assert merged_ids == ["g1"]
        merged_sidecar = json.loads((tmp_path / "merged.failed_ids.json").read_text())
        assert merged_sidecar == ["g2"]

    def test_summary_does_not_mention_allow_missing_when_not_provided(
        self, tmp_path, capsys
    ):
        """The 'allowed via --allow-missing' wording implies the flag was
        active; it must not appear when the merge succeeded purely on known
        failures and --allow-missing was never passed."""
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}, {"id": "g2"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g1", "agent_findings": []}])
        write_sidecar(shard0, ["g2"])

        output = tmp_path / "merged.jsonl"
        merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0)],
            allow_missing=False,
        )

        assert "--allow-missing" not in capsys.readouterr().out

    def test_missing_sidecar_file_makes_its_gaps_unaccounted(self, tmp_path):
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}, {"id": "g2"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g1", "agent_findings": []}])
        # No sidecar written at all for shard0: g2's absence can't be
        # attributed to a known failure, so it must be treated as
        # unaccounted (fatal by default).

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0)],
            allow_missing=False,
        )

        assert exit_code == 2
        assert not output.exists()


class TestMergeUnexpectedIds:
    def test_id_not_in_gold_or_seeded_is_fatal_even_with_allow_missing(self, tmp_path):
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(
            shard0,
            [
                {"id": "g1", "agent_findings": []},
                {"id": "not-in-gold-or-seeded", "agent_findings": []},
            ],
        )
        write_sidecar(shard0, [])

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0)],
            allow_missing=True,
        )

        assert exit_code == 2
        assert not output.exists()


class TestMergeMissingShardFile:
    def test_shard_file_that_was_never_written_is_treated_as_unaccounted_not_a_crash(
        self, tmp_path
    ):
        """A shard killed mid-run before _write_predictions_and_sidecar ran
        leaves no predictions file and no sidecar at all -- merge() must
        report this as the usual fatal unaccounted-ids error, not crash with
        an uncaught FileNotFoundError."""
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}, {"id": "g2"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g1", "agent_findings": []}])
        write_sidecar(shard0, [])
        shard1 = tmp_path / "shard1.jsonl"  # never created

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0), str(shard1)],
            allow_missing=False,
        )

        assert exit_code == 2
        assert not output.exists()

    def test_missing_shard_file_accepted_with_allow_missing(self, tmp_path):
        gold = tmp_path / "gold.jsonl"
        write_jsonl(gold, [{"id": "g1"}, {"id": "g2"}])
        seeded = tmp_path / "seeded.jsonl"
        write_jsonl(seeded, [])

        shard0 = tmp_path / "shard0.jsonl"
        write_jsonl(shard0, [{"id": "g1", "agent_findings": []}])
        write_sidecar(shard0, [])
        shard1 = tmp_path / "shard1.jsonl"  # never created

        output = tmp_path / "merged.jsonl"
        exit_code = merge_predictions.merge(
            gold=str(gold),
            seeded=str(seeded),
            output=str(output),
            pred_paths=[str(shard0), str(shard1)],
            allow_missing=True,
        )

        assert exit_code == 1
        merged_ids = [
            json.loads(line)["id"] for line in output.read_text().splitlines()
        ]
        assert merged_ids == ["g1"]
