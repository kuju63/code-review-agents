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
targets at random (stratified ~50/50 by repo_type) instead of processing the
whole tagged pool, which keeps day-to-day iteration fast:

bash evaluation/tools/run_evaluation_pipeline.sh

To use a smaller/larger fast sample:

bash evaluation/tools/run_evaluation_pipeline.sh --sample-n 8

For a full, deterministic run (weekly refresh / release-gate evaluation per
[EVALUATION_PLAN.md](EVALUATION_PLAN.md) §5.1), use `--limit` instead of
`--sample-n` (they are mutually exclusive):

bash evaluation/tools/run_evaluation_pipeline.sh \
  --limit 30 \
  --min-risk medium

For security-focused sample selection:

bash evaluation/tools/run_evaluation_pipeline.sh \
  --profile security \
  --limit 30 \
  --min-risk medium

This executes Step 1 to Step 3 below. See
[docs/evaluation-pipeline-design.md](../docs/evaluation-pipeline-design.md)
for the full data flow diagram and the `input/` vs `data/` directory split.

## 1. Build execution target list from tagged candidates

Fast sampling (recommended for local iteration; n=15, stratified by repo_type):

python evaluation/tools/convert_tagged_targets.py \
  --input evaluation/input/pr_targets_b2b2c_tagged.json \
  --output evaluation/data/pr_targets.json \
  --limit 15 \
  --shuffle \
  --stratify-repo-type \
  --balanced \
  --min-risk medium \
  --print-summary

Full/deterministic selection (weekly refresh / release-gate evaluation):

python evaluation/tools/convert_tagged_targets.py \
  --input evaluation/input/pr_targets_b2b2c_tagged.json \
  --output evaluation/data/pr_targets.json \
  --limit 30 \
  --balanced \
  --min-risk medium \
  --print-summary

Checkpoint:

- `evaluation/data/pr_targets.json` exists
- Stack distribution in summary is reasonable
- Any `[COVERAGE-WARN]` lines on stderr are non-blocking; review them, don't
  treat them as a failure (see EVALUATION_PLAN.md §2.0.3 for known population
  constraints in the current tagged pool)

## 2. Build Gold set

python evaluation/tools/build_gold_set.py \
  --input evaluation/data/pr_targets.json \
  --output evaluation/data/gold_pr_set.jsonl

Checkpoint:

- `evaluation/data/gold_pr_set.jsonl` exists
- Rows are generated and not empty

## 3. Build Seeded set

Requires a Seeded mutation generation model to be configured (Phase2:
LLM inference + deterministic post-generation checks, see
[docs/eval-seeded-mutation-injection-design.md](../docs/eval-seeded-mutation-injection-design.md)
3.2). Set `SEEDED_GEN_MODEL_ID` in `.env` (see `.env.example`), or pass
`--model-id` explicitly; there is no implicit default model.

python evaluation/tools/build_seeded_set.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --catalog evaluation/config/seeded_mutations.json \
  --output evaluation/data/seeded_set.jsonl \
  --multiplier 2

Checkpoint:

- `evaluation/data/seeded_set.jsonl` exists
- Must-find labels are present
- Each row's `generation_source` is either `"llm"` (LLM mutation passed
  all post-generation checks) or `"deterministic_fallback"` (checks
  failed or no LLM output; Phase1 logic was used instead) -- both are
  expected, not an error

### Regenerating after a Seeded generation model change

`SEEDED_GEN_MODEL_ID` / `SEEDED_GEN_LLM_BASE_URL` is not part of the
cache key for `evaluation/data/seeded_set.jsonl` (design doc 3.2.4:
generation is a build-time, one-off process). If you change the
generation model, delete and rebuild manually -- it will not happen
automatically:

rm evaluation/data/seeded_set.jsonl
python evaluation/tools/build_seeded_set.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --catalog evaluation/config/seeded_mutations.json \
  --output evaluation/data/seeded_set.jsonl \
  --multiplier 2

## 4. Run review agent pipeline

Run the review agent on both Gold and Seeded inputs via the A2A server
(see [.claude/skills/run-evaluation/SKILL.md](../.claude/skills/run-evaluation/SKILL.md)
for the full start/stop sequence):

python evaluation/tools/run_agent_evaluation.py \
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
      "path": "src/a.ts",
      "line": 123,
      "summary": "..."
    }
  ]
}

## 5. Score evaluation

python evaluation/tools/score_evaluation.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl

Add `--semantic-judge` (optionally with `--model-id` / `--llm-base-url`) to
enable LLM-as-judge content matching on top of path/line/category — see
EVALUATION_PLAN.md §3.1.1 Matching rule. Do not use it for Seeded-set hard
gate runs (§6): it introduces non-determinism.

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

- Use PRs with more review comments
- Lower `--min-risk` in converter
- Add more PR candidates in tagged input

If Seeded recall is unstable:

- Increase multiplier from 2 to 3
- Review mutation catalog by stack

If `build_seeded_set.py` exits with
`[SEEDED-ERROR] no generation model configured`:

- Set `SEEDED_GEN_MODEL_ID` in `.env` (see `.env.example`), or pass
  `--model-id` explicitly
- This is intentional: there is no implicit default generation model
  (see docs/eval-seeded-mutation-injection-design.md 3.2.6)

If stack balance is broken:

- Use `--balanced` in converter
- Increase candidate pool in underrepresented stack

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
