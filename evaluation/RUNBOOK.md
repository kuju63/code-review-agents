# Evaluation Runbook

This runbook is the operational guide for running evaluation end-to-end.

## 0. Preconditions

- Working directory: repository root
- Python 3.11+ recommended
- GitHub token is available

Set token:

export GITHUB_TOKEN=your_token

## Quick Start (recommended)

Run all dataset preparation steps in one command:

bash evaluation/tools/run_evaluation_pipeline.sh

For security-focused sample selection:

bash evaluation/tools/run_evaluation_pipeline.sh \
  --profile security \
  --limit 30 \
  --min-risk medium

This executes Step 1 to Step 3 below.

## 1. Build execution target list from tagged candidates

Default command (recommended first run):

python evaluation/tools/convert_tagged_targets.py \
  --input evaluation/input/pr_targets_b2b2c_tagged.json \
  --output evaluation/input/pr_targets.json \
  --limit 30 \
  --balanced \
  --min-risk medium \
  --print-summary

Checkpoint:

- `evaluation/input/pr_targets.json` exists
- Stack distribution in summary is reasonable

## 2. Build Gold set

python evaluation/tools/build_gold_set.py \
  --input evaluation/input/pr_targets.json \
  --output evaluation/data/gold_pr_set.jsonl

Checkpoint:

- `evaluation/data/gold_pr_set.jsonl` exists
- Rows are generated and not empty

## 3. Build Seeded set

python evaluation/tools/build_seeded_set.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --catalog evaluation/config/seeded_mutations.json \
  --output evaluation/data/seeded_set.jsonl \
  --multiplier 2

Checkpoint:

- `evaluation/data/seeded_set.jsonl` exists
- Must-find labels are present

## 4. Run review agent pipeline

Run your existing review agent on both Gold and Seeded inputs and store:

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

If stack balance is broken:

- Use `--balanced` in converter
- Increase candidate pool in underrepresented stack
