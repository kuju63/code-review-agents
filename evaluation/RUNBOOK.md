# Evaluation Runbook

This runbook is the operational guide for running evaluation end-to-end.

## 0. Preconditions

- Working directory: repository root
- Python 3.11+ recommended
- GitHub token is available

Set token:

export GITHUB_TOKEN=your_token

## Quick Start (recommended)

Run all dataset preparation steps in one command. By default this samples n=15
targets at random (stratified ~50/50 by repo_type) from the four per-stack
target files, which keeps day-to-day iteration fast:

bash evaluation/tools/run_evaluation_pipeline.sh

To use a smaller/larger fast sample:

bash evaluation/tools/run_evaluation_pipeline.sh --sample-n 8

For a full, deterministic run (weekly refresh / release-gate evaluation per
[EVALUATION_PLAN.md](EVALUATION_PLAN.md) §5.1), use `--limit` instead of
`--sample-n` (they are mutually exclusive):

bash evaluation/tools/run_evaluation_pipeline.sh \
  --limit 30 \
  --min-severity medium

For security-focused sample selection:

bash evaluation/tools/run_evaluation_pipeline.sh \
  --profile security \
  --limit 30 \
  --min-severity medium

This executes Step 1 to Step 3 below. See
[docs/evaluation-pipeline-design.md](../docs/evaluation-pipeline-design.md)
for the full data flow diagram and the `input/` vs `data/` directory split.

## 1. Build execution target list from per-stack targets

The canonical inputs are:

- `evaluation/input/pr_targets_react.json`
- `evaluation/input/pr_targets_vue.json`
- `evaluation/input/pr_targets_angular.json`
- `evaluation/input/pr_targets_svelte.json`

Fast sampling (recommended for local iteration; n=15, stratified by repo_type):

```bash
uv run python evaluation/tools/select_stack_targets.py \
  --inputs evaluation/input/pr_targets_{react,vue,angular,svelte}.json \
  --output evaluation/data/pr_targets.json \
  --limit 15 \
  --shuffle \
  --stratify-repo-type \
  --balanced \
  --min-severity medium \
  --print-summary
```

Full/deterministic selection (weekly refresh / release-gate evaluation):

```bash
uv run python evaluation/tools/select_stack_targets.py \
  --inputs evaluation/input/pr_targets_{react,vue,angular,svelte}.json \
  --output evaluation/data/pr_targets.json \
  --limit 30 \
  --balanced \
  --min-severity medium \
  --print-summary
```

Security-only selection adds `--impact security`. Priority can be restricted
with `--priority high,medium`.

Checkpoint:

- `evaluation/data/pr_targets.json` exists
- Stack, repository-type, severity, impact, and priority distributions are reasonable
- Any `[COVERAGE-WARN]` lines on stderr are non-blocking; review them, don't
  treat them as a failure (see EVALUATION_PLAN.md §2.0.3)

## 2. Build Gold set

uv run python evaluation/tools/build_gold_set.py \
  --input evaluation/data/pr_targets.json \
  --output evaluation/data/gold_pr_set.jsonl

Checkpoint:

- `evaluation/data/gold_pr_set.jsonl` exists
- Rows are generated and not empty

## 3. Build Seeded set

Fetches real PRs from the dedicated seed repositories
(`kuju63/{react,vue,angular,svelte}-seeded`, Issue #224) and resolves each
PR's `INTENTIONAL` marker comment(s) to a `must_find` entry using the
hand-authored metadata in `evaluation/input/seeded_pr_targets_{stack}.json`.
See [docs/eval-seeded-repo-based-generation-spec.md](../docs/eval-seeded-repo-based-generation-spec.md)
for the full design. Requires `GITHUB_TOKEN` (same token as step 2); there
is no generation model to configure.

uv run python evaluation/tools/build_seeded_set.py \
  --targets evaluation/input/seeded_pr_targets_react.json \
            evaluation/input/seeded_pr_targets_vue.json \
            evaluation/input/seeded_pr_targets_angular.json \
            evaluation/input/seeded_pr_targets_svelte.json \
  --output evaluation/data/seeded_set.jsonl

Checkpoint:

- `evaluation/data/seeded_set.jsonl` exists with one row per PR (59 as of
  Issue #224's initial migration) and every row's `must_find` has at least
  one entry
- The build fails closed rather than producing a partial file: a missing
  marker, a marker/metadata count mismatch, or a marker sitting on a file
  `pr_info_collector.is_target_file()` would exclude from review all raise
  and stop the run. If the build fails, fix the failing PR's metadata entry
  (or the seed repository's PR) rather than working around the error.
- To inspect one PR's markers before writing its metadata (or to debug a
  fail-closed error), use `--print-markers` with `--pr`:

  uv run python evaluation/tools/build_seeded_set.py \
    --targets evaluation/input/seeded_pr_targets_vue.json \
    --pr kuju63/vue-seeded#13 --print-markers

## 4. Run review agent pipeline

Run the review agent on both Gold and Seeded inputs via the A2A server
(see [.claude/skills/run-evaluation/SKILL.md](../.claude/skills/run-evaluation/SKILL.md)
for the full start/stop sequence):

uv run python evaluation/tools/run_agent_evaluation.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --output evaluation/data/agent_predictions.jsonl \
  --concurrency 2

`--concurrency` (default 2) evaluates that many Gold/Seeded items at once
instead of one at a time. A realistic ceiling is hardware- and rate-limit-
dependent; raising it increases the risk of hitting `--timeout` (default
1800s) on individual items. This produces:

- `evaluation/data/agent_predictions.jsonl`

Minimum record format:

{
  "id": "sample-id",
  "agent_findings": [
    {
      "category": "security",
      "severity": "high",
      "impact": "security",
      "priority": "high",
      "path": "src/a.ts",
      "line": 123,
      "summary": "..."
    }
  ]
}

Axis agreement uses only matched pairs where both sides contain canonical values. Missing, `unknown`, or invalid axis values are excluded independently, and a reported `0.0` with `n=0` means no eligible labels rather than complete disagreement.

After writing `agent_predictions.jsonl`, `run_agent_evaluation.py` invokes
`evaluation/tools/generate_evaluation_report.py` as a subprocess (the same
pattern it already uses for `score_evaluation.py`) to score, write the
Markdown report, and send the Discord notification. This is unchanged from
before the sharded-execution support below was added — see
[docs/eval-sharded-execution-spec.md](../docs/eval-sharded-execution-spec.md).

### 4a. Sharded execution (time-constrained environments)

Some execution environments (for example OpenCode, whose invocations reset
every 2 hours) cap wall-clock time per invocation below what a full
Gold+Seeded run can take. When `--concurrency 2` and `--timeout 1800`
(defaults) do not fit in the available window, split the run into shards:

```bash
uv run python evaluation/tools/run_agent_evaluation.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --output evaluation/data/shard0.jsonl \
  --shard-index 0 --shard-count 4

# repeat for --shard-index 1, 2, 3 with matching --output paths
```

Each shard evaluates only every `--shard-count`-th Gold/Seeded item
(0-based `--shard-index`) and skips report generation. `run_agent_evaluation.py`
never stops the A2A server itself (sharded or not) — the server must stay up
across all shard invocations, and shutdown is the sole responsibility of
[.claude/skills/run-evaluation/SKILL.md](../.claude/skills/run-evaluation/SKILL.md)
Step 5 (`scripts/stop_a2a_container.sh`), run once every shard has finished.

**Seeded items' timeout budget** (Issue #237): Seeded items now execute all
three pipeline stages (pr-info-collector, parallel technical+security review,
lead engineer synthesis) inside a single polled `/orchestrator` task, the same
as Gold items. Before Issue #237, Seeded items had a separate `--timeout`
budget per stage across three individually polled A2A calls; that per-stage
margin is gone. If Seeded items start hitting `--timeout` more often after
this change, raise `--timeout` rather than `--concurrency` first — the shard
formula below is unaffected, but each item's per-run safety margin is
smaller than it used to be.

**Choosing `--shard-count`**: pick the smallest value satisfying

```text
(ceil(gold_count / shard_count / concurrency)
 + ceil(seeded_count / shard_count / concurrency)) * timeout <= available_window
```

With today's dataset (Gold 8 / Seeded 16, `--concurrency 2`, `--timeout 1800`)
and a 2-hour window, `shard-count = 3` gives `(ceil(3/2) + ceil(6/2)) * 1800
= 9000s ≈ 2.5h` — too slow — while `shard-count = 4` gives `(1 + 2) * 1800 =
5400s = 1.5h`, which fits. Recompute this whenever the dataset grows.

All shards must run against the same (byte-identical) `--gold`/`--seeded`
files, since the split is positional (`items[shard_index::shard_count]`);
each shard needs a distinct `--output` path.

Once every shard has finished, merge them:

```bash
uv run python evaluation/tools/merge_predictions.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --output evaluation/data/agent_predictions.jsonl \
  evaluation/data/shard0.jsonl evaluation/data/shard1.jsonl \
  evaluation/data/shard2.jsonl evaluation/data/shard3.jsonl
```

By default, an id missing from both the merged predictions and every
shard's `failed_ids.json` sidecar is treated as **unaccounted** and fails
the merge (exit code 2). This is deliberately stricter than the
non-sharded run's "partial results are fine" tolerance: with no sidecar
evidence, an unaccounted id can't be told apart from a shard invocation
that was killed mid-run by the same execution-time limit this workflow
exists to work around, before it wrote anything. Do not reach for
`--allow-missing` as a routine flag — check the shard's logs first — and
use it only once you have confirmed the gap is an accepted per-item
failure, not a shard that silently never ran.

Then generate the score, Markdown report, and Discord notification from the
merged predictions:

```bash
uv run python evaluation/tools/generate_evaluation_report.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl
```

This is the same script the non-sharded path in §4 calls automatically, so
the output (`report_YYYYMMDD-HHMMSS-<hash>.md`, Discord notification) is
identical either way.

## 5. Score evaluation

uv run python evaluation/tools/score_evaluation.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl

Add `--semantic-judge` (optionally with `--model-id` / `--llm-base-url` /
`--provider-type`) to enable LLM-as-judge content matching on top of
path/line/category — see EVALUATION_PLAN.md §3.1.1 Matching rule. Do not
use it for Seeded-set hard gate runs (§6): it introduces non-determinism.

## 6. Gate decision

Check against [evaluation/EVALUATION_PLAN.md](evaluation/EVALUATION_PLAN.md) gates:

- Critical Miss Rate = 0
- Must-Find Recall >= 0.95
- Gold Recall and Precision targets

## 7. Weekly operation

1. Refresh 20-30% of target PRs
2. Rebuild Gold and Seeded
3. Re-run scoring
4. Track trend by stack (React/Vue/Angular/Svelte)

## Troubleshooting

If Gold rows are too few:

- Lower `--min-severity` or relax `--impact` / `--priority` in the selector
- Confirm selected PRs still satisfy the shared production-file and inline-comment criteria
- Add repositories to `repo_candidates.json` and regenerate the per-stack targets

If Seeded recall is unstable:

- Check whether it's a location-precision issue (line tolerance ±5) or a
  genuine miss by re-running the failing item with `--print-markers`
  against the same PR
- Review that PR's defect for reachability -- since seed PRs are real,
  hand-authored code, an unstable recall on a specific PR usually means
  the reviewer isn't covering that defect category, not a dataset defect

If `build_seeded_set.py` exits with a fail-closed `ValueError`
(marker/metadata mismatch, or a marker on a file `is_target_file()`
excludes):

- This is intentional (see
  [docs/eval-seeded-repo-based-generation-spec.md](../docs/eval-seeded-repo-based-generation-spec.md)
  §5.2): a silent mismatch would otherwise reproduce the mutation-injection
  pipeline's characteristic failure mode of a must_find quietly scoring
  zero
- Re-run with `--pr owner/repo#N --print-markers` for the failing PR to see
  what markers were actually detected, then fix the corresponding
  `seeded_pr_targets_{stack}.json` entry (or the seed repository's PR)

If stack balance is broken:

- Use `--balanced` in `select_stack_targets.py`
- Add repositories for the underrepresented stack and regenerate its target file

If `[COVERAGE-WARN]` keeps appearing:

- This is non-blocking by design; the pipeline still completes
- Angular/Svelte and performance/maintainability-tagged PRs are scarce in the
  current tagged pool (see EVALUATION_PLAN.md §2.0.3), so some warnings are
  structural and will not go away with a different `--seed`
- For a release-gate decision, prefer `--limit` (full/deterministic) over
  `--sample-n` so composition is not left to chance

If evaluation runs are slow:

- Reduce dataset size with `--sample-n` (fewer items reach the agent
  execution step, which dominates wall-clock time)
- Increase `--concurrency` on `run_agent_evaluation.py` cautiously (default 2);
  watch for `--timeout` failures in the run's `[WARN]` output before raising it
  further
- If a single invocation cannot fit the full run in its execution window at
  all (rather than merely being slow), split it with `--shard-index`/
  `--shard-count` — see §4a above.
