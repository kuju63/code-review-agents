# Evaluation Toolkit

This directory contains a practical evaluation toolkit for a solo developer.

Main target stacks for this toolkit:

- Front-end primary repositories (React/Vue/Angular/Svelte)

Backend stacks (Ruby on Rails, Spring Boot) are out of scope for now: with
current review resources it isn't realistic to cover every stack, so
evaluation focuses on improving frontend review accuracy first.

Main business domain:

- Business applications and B2B2C services

## What You Get

- Evaluation design: `evaluation/EVALUATION_PLAN.md`
- Matching rubric: `evaluation/RUBRIC.md`
- Gold schema: `evaluation/schema/gold_pr_item.schema.json`
- Seeded schema: `evaluation/schema/seeded_item.schema.json`
- Gold builder: `evaluation/tools/build_gold_set.py`
- Seeded builder: `evaluation/tools/build_seeded_set.py`
- Scorer: `evaluation/tools/score_evaluation.py`
- Target selector: `evaluation/tools/select_stack_targets.py`
- Pipeline runner: `evaluation/tools/run_evaluation_pipeline.sh`
- Mutation catalog: `evaluation/config/seeded_mutations.json`

## Recommended Entry Point

Start from the canonical per-stack target files:

1. Select an execution target list from `pr_targets_{stack}.json`
2. Build Gold set
3. Build Seeded set
4. Run agent and score

For detailed end-to-end run steps, see `evaluation/RUNBOOK.md`.

## One-Command Dataset Build

Build targets, Gold, and Seeded in one command:

```bash
bash evaluation/tools/run_evaluation_pipeline.sh
```

Security-focused variant:

```bash
bash evaluation/tools/run_evaluation_pipeline.sh \
  --profile security \
  --limit 30 \
  --min-severity medium
```

If you already have `evaluation/data/pr_targets.json` and only want Gold+Seeded:

```bash
bash evaluation/tools/run_evaluation_pipeline.sh \
  --skip-select
```

## Quickstart (Solo Developer Friendly)

## 1) Prepare PR target list

`evaluation/data/pr_targets.json` is the generated execution target list
(derived data — see [docs/evaluation-pipeline-design.md](../docs/evaluation-pipeline-design.md)
for the `input/` vs `data/` directory split). The canonical source data are
`evaluation/input/pr_targets_{react,vue,angular,svelte}.json`.

Example 1: select all targets

```bash
uv run python evaluation/tools/select_stack_targets.py \
  --inputs evaluation/input/pr_targets_{react,vue,angular,svelte}.json \
  --output evaluation/data/pr_targets.json \
  --print-summary
```

Example 2: pick 30 targets, balanced by stack, medium severity or higher

```bash
uv run python evaluation/tools/select_stack_targets.py \
  --inputs evaluation/input/pr_targets_{react,vue,angular,svelte}.json \
  --output evaluation/data/pr_targets.json \
  --limit 30 \
  --balanced \
  --min-severity medium \
  --print-summary
```

Example 3: focus on security impact and high/medium priority

```bash
uv run python evaluation/tools/select_stack_targets.py \
  --inputs evaluation/input/pr_targets_{react,vue,angular,svelte}.json \
  --output evaluation/data/pr_targets_security.json \
  --impact security \
  --priority high,medium \
  --min-severity medium \
  --print-summary
```

To refresh the source pools, run `discover_candidate_prs.py` as documented in
[docs/goldset-per-stack-spec.md](../docs/goldset-per-stack-spec.md).

## 2) Build Gold set automatically

Set token and run:

```bash
export GITHUB_TOKEN=your_token
uv run python evaluation/tools/build_gold_set.py \
  --input evaluation/data/pr_targets.json \
  --output evaluation/data/gold_pr_set.jsonl
```

Expected output:

- `evaluation/data/gold_pr_set.jsonl`
- Each row contains filtered file diffs and normalized human findings

## 3) Build Seeded set automatically

```bash
uv run python evaluation/tools/build_seeded_set.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --catalog evaluation/config/seeded_mutations.json \
  --output evaluation/data/seeded_set.jsonl \
  --multiplier 2
```

Expected output:

- `evaluation/data/seeded_set.jsonl`
- Each row includes one must-find issue with category/severity/line metadata

## 4) Run your review agents against both sets

Use `evaluation/tools/run_agent_evaluation.py` with the local A2A server to produce structured review output.

Recommended output format per sample:

```json
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
  ],
  "lead_decisions": [
    {
      "path": "src/a.ts",
      "line": 123,
      "decision": "accept"
    }
  ]
}
```

## 5) Evaluate with gates

Use `evaluation/EVALUATION_PLAN.md` thresholds as release gates.

Example scoring run:

```bash
uv run python evaluation/tools/score_evaluation.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl
```

Minimum recommended start point:

- Critical Miss Rate = 0 (Seeded)
- Must-Find Recall >= 0.95 (Seeded)
- Gold Recall >= 0.70
- Gold Precision >= 0.60

## Practical Notes for Solo Development

- You do not need to handcraft Gold data from scratch.
  - Use public PR review comments as weak supervision.
- You do not need to handwrite all Seeded data.
  - Generate from Gold with mutation catalog and iterate monthly.
- Keep versioned snapshots:
  - `evaluation/data/v1/*`
  - `evaluation/data/v2/*`

## Known Limitations

- Gold extraction currently relies on review comments API and simple heuristics.
- Severity/category normalization is keyword-based and should be calibrated with small manual checks.
- Mutation injection currently supports Front-end patterns only (React/Vue/Angular/Svelte); backend-specific traps (Rails, Spring Boot) are intentionally out of scope while resources are focused on frontend review accuracy, and can be reconsidered later in `seeded_mutations.json`.
