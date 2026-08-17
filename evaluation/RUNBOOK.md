# Evaluation Runbook

This runbook is the operational guide for running evaluation end-to-end.

## 0. Preconditions

- Working directory: repository root
- Nix available for the TypeScript evaluation workspace commands
  (`evaluation/tools/` is fully TypeScript as of Issue #255; only the review
  agent itself, run separately via the A2A server container, remains Python
  for now)
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

For a full, deterministic run required for release-gate evaluation
([EVALUATION_PLAN.md](EVALUATION_PLAN.md) §5.1 requires the full Gold+Seeded
population, including low-severity items), pass `--limit 0` (unlimited) and
`--min-severity low`. Note that `run_evaluation_pipeline.sh` defaults
`--min-severity` to `medium` on its own even when the flag is omitted, so
`--min-severity low` must be passed explicitly here:

bash evaluation/tools/run_evaluation_pipeline.sh \
  --limit 0 \
  --min-severity low

For a smaller, still-deterministic 30-target sample (not valid as a
release-gate signal; see §2.0.3), use `--limit` with a `--min-severity`
floor:

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
nix develop --command pnpm --filter @code-review-agent/evaluation run select-stack-targets \
  --inputs evaluation/input/pr_targets_{react,vue,angular,svelte}.json \
  --output evaluation/data/pr_targets.json \
  --limit 15 \
  --shuffle \
  --stratify-repo-type \
  --balanced \
  --min-severity medium \
  --print-summary
```

Full population selection, required for release-gate evaluation
(EVALUATION_PLAN.md §5.1 — includes low-severity items; do not add
`--min-severity` here):

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation run select-stack-targets \
  --inputs evaluation/input/pr_targets_{react,vue,angular,svelte}.json \
  --output evaluation/data/pr_targets.json \
  --balanced \
  --print-summary
```

Deterministic 30-target sample (not valid as a release-gate signal; see
§2.0.3):

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation run select-stack-targets \
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

nix develop --command pnpm --filter @code-review-agent/evaluation run build-gold-set \
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

nix develop --command pnpm --filter @code-review-agent/evaluation run build-seeded-set \
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
  marker, a marker/metadata count mismatch, or a marker sitting in a file the
  shared target-file predicate would exclude from review all raise
  and stop the run. If the build fails, fix the failing PR's metadata entry
  (or the seed repository's PR) rather than working around the error.
- To inspect one PR's markers before writing its metadata (or to debug a
  fail-closed error), use `--print-markers` with `--pr`:

  nix develop --command pnpm --filter @code-review-agent/evaluation run build-seeded-set \
    --targets evaluation/input/seeded_pr_targets_vue.json \
    --pr kuju63/vue-seeded#13 --print-markers

## 4. Run review agent pipeline

Run the review agent on both Gold and Seeded inputs via the A2A server
(see [.claude/skills/run-evaluation/SKILL.md](../.claude/skills/run-evaluation/SKILL.md)
for the full start/stop sequence). `run-agent-evaluation` has no
`packages/evaluation/package.json` script entry yet (a pre-existing gap
predating this Issue #255 cleanup — it shipped without one in Issue #306/#307
on `main`), so invoke it via `tsx` directly:

nix develop --command pnpm --filter @code-review-agent/evaluation exec tsx \
  src/run-agent-evaluation.ts \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl \
  --base-url http://localhost:8000 \
  --concurrency 2

`--base-url` must be passed explicitly: the command's own default
(`http://localhost:3000`, matching `packages/a2a-server`'s hardcoded port) does
not match the port the evaluation A2A container actually publishes
(`localhost:8000`, the default the retired Python runner used — see
[.claude/skills/run-evaluation/scripts/start_a2a_container.sh](../.claude/skills/run-evaluation/scripts/start_a2a_container.sh)).

`--concurrency` (default 2) evaluates that many Gold/Seeded items at once
instead of one at a time. A realistic ceiling is hardware- and rate-limit-
dependent; raising it increases the risk of hitting `--timeout` (default
1800s) on individual items.

**Seeded items' timeout budget** (Issue #237): Seeded items execute all
three pipeline stages (pr-info-collector, parallel technical+security review,
lead engineer synthesis) inside a single polled `/orchestrator` task, the same
as Gold items. Before Issue #237, Seeded items had a separate `--timeout`
budget per stage across three individually polled A2A calls; that per-stage
margin is gone. If Seeded items start hitting `--timeout` more often, raise
`--timeout` rather than `--concurrency` first — each item's per-run safety
margin is smaller than it used to be.

This produces:

- `evaluation/data/agent_predictions.jsonl`
- `evaluation/data/agent_predictions.failed_ids.json` (sidecar; always
  written, even when empty)

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

Unlike the retired Python runner, `run-agent-evaluation` does **not**
automatically invoke report generation afterward
(`docs/ts-agent-evaluation-runner-spec.md` §2.2 scoped that out deliberately —
predictions.jsonl + the failed_ids sidecar are its only contract). Score,
write the Markdown report, and send the Discord notification as an explicit
follow-up step:

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation run generate-evaluation-report \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl
```

### 4a. Time-constrained environments (sharded execution retired)

The Python runner's `--shard-index`/`--shard-count` convenience flags — for
environments that cap wall-clock time per invocation below what a full
Gold+Seeded run takes (for example OpenCode, whose invocations reset every 2
hours) — were an explicit non-goal of the TypeScript port
(`docs/ts-agent-evaluation-runner-spec.md` §2.2: "shard実行...Python版に残す")
and were removed along with `run_agent_evaluation.py` in Issue #255. There is
currently no TypeScript equivalent that auto-splits a run.

If a single invocation cannot fit its window, the only available workaround is
manual: split `gold_pr_set.jsonl`/`seeded_set.jsonl` into disjoint subset
files yourself, run `run-agent-evaluation` once per subset with a distinct
`--pred` path each time (each run still writes its own `<pred>.failed_ids.json`
sidecar, using the same naming contract as before —
[docs/eval-sharded-execution-spec.md](../docs/eval-sharded-execution-spec.md)
§2.4), then merge the results with the still-available `merge-predictions`
tool, passing the **original, full** `--gold`/`--seeded` files so it can
verify every id is accounted for:

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation run merge-predictions \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --output evaluation/data/agent_predictions.jsonl \
  evaluation/data/part0.jsonl evaluation/data/part1.jsonl
```

By default, an id missing from both the merged predictions and every part's
`failed_ids.json` sidecar is treated as **unaccounted** and fails the merge
(exit code 2) — this is deliberate: with no sidecar evidence, an unaccounted
id can't be told apart from a run that was killed mid-way through by the same
execution-time limit this workaround exists for, before it wrote anything.
Do not reach for `--allow-missing` as a routine flag — check the run's logs
first — and use it only once you have confirmed the gap is an accepted
per-item failure, not a part that silently never ran.

`run-agent-evaluation` never stops the A2A server itself — the server must
stay up across every manual invocation, and shutdown is the sole
responsibility of
[.claude/skills/run-evaluation/SKILL.md](../.claude/skills/run-evaluation/SKILL.md)
Step 5 (`scripts/stop_a2a_container.sh`), run once every part has finished.

Once merged, generate the score, Markdown report, and Discord notification
exactly as in §4:

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation run generate-evaluation-report \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl
```

A single part's partial predictions/score must never be used as the basis for
a gate decision (§6) — only the merged output covering the full Gold+Seeded
population qualifies.

## 5. Score evaluation

nix develop --command pnpm --filter @code-review-agent/evaluation run score-evaluation \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl

Add `--semantic-judge` (optionally with `--model-id` / `--llm-base-url` /
`--provider-type`) to enable LLM-as-judge content matching on top of
path/line/category — see EVALUATION_PLAN.md §3.1.1 Matching rule. Do not
use it for Seeded-set hard gate runs (§6): it introduces non-determinism.

The actual judge-parity run is performed on the designated evaluation machine
using the same prediction file for the legacy and migrated judges. Migration
acceptance requires Must-Find Recall to remain within -5 points of the
Epic #249 Step 1 baseline and to be at least 0.60 in absolute terms.

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

If `build-seeded-set` exits with a fail-closed error
(marker/metadata mismatch, or a marker on a file the shared target-file
predicate excludes):

- This is intentional (see
  [docs/eval-seeded-repo-based-generation-spec.md](../docs/eval-seeded-repo-based-generation-spec.md)
  §5.2): a silent mismatch would otherwise reproduce the mutation-injection
  pipeline's characteristic failure mode of a must_find quietly scoring
  zero
- Re-run with `--pr owner/repo#N --print-markers` for the failing PR to see
  what markers were actually detected, then fix the corresponding
  `seeded_pr_targets_{stack}.json` entry (or the seed repository's PR)

If stack balance is broken:

- Use `--balanced` in `select-stack-targets`
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
- Increase `--concurrency` on `run-agent-evaluation` cautiously (default 2);
  watch for `--timeout` failures in the run's `[WARN]` output before raising it
  further
- If a single invocation cannot fit the full run in its execution window at
  all (rather than merely being slow), there is no automatic split anymore —
  see §4a above for the manual workaround.
