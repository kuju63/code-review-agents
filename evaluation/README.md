# Evaluation Toolkit

This directory contains a practical evaluation toolkit for a solo developer.

Main target stacks for this toolkit:

- Ruby on Rails application repositories
- Front-end primary repositories (React/Vue/Svelte)
- Spring Boot repositories (including enterprise template based apps)

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
- Target converter: `evaluation/tools/convert_tagged_targets.py`
- Pipeline runner: `evaluation/tools/run_evaluation_pipeline.sh`
- Mutation catalog: `evaluation/config/seeded_mutations.json`

## Recommended Entry Point

If you already have tagged candidates, start here:

1. Convert tagged list into execution target list
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
  --min-risk medium
```

If you already have `pr_targets.json` and only want Gold+Seeded:

```bash
bash evaluation/tools/run_evaluation_pipeline.sh \
  --skip-convert
```

## Quickstart (Solo Developer Friendly)

## 1) Prepare PR target list

Create `evaluation/input/pr_targets.json` with 30-50 PRs:

```json
[
  {"repository": "vercel/next.js", "pr_number": 10000},
  {"repository": "facebook/react", "pr_number": 20000}
]
```

Tip:

- Start from repos similar to your target stack
- Prefer PRs that include code review comments
- Avoid gigantic PRs in early phase
- You can copy from `evaluation/input/pr_targets.example.json`
- Keep stack balance close to Rails 30%, Spring 30%, Front-end 40%
- For B2B2C, prioritize auth, tenant, billing, PII, and workflow-related PRs

Alternative: generate `pr_targets.json` from tagged candidates automatically.

Example 1: convert all tagged items

```bash
python evaluation/tools/convert_tagged_targets.py \
  --input evaluation/input/pr_targets_b2b2c_tagged.json \
  --output evaluation/input/pr_targets.json \
  --print-summary
```

Example 2: pick top 30, balanced by stack, medium risk or higher

```bash
python evaluation/tools/convert_tagged_targets.py \
  --input evaluation/input/pr_targets_b2b2c_tagged.json \
  --output evaluation/input/pr_targets.json \
  --limit 30 \
  --balanced \
  --min-risk medium \
  --print-summary
```

Example 3: focus on security and tenant themes

```bash
python evaluation/tools/convert_tagged_targets.py \
  --input evaluation/input/pr_targets_b2b2c_tagged.json \
  --output evaluation/input/pr_targets_security.json \
  --themes-any security,tenant,isolation,auth \
  --min-risk medium \
  --print-summary
```

## 2) Build Gold set automatically

Set token and run:

```bash
export GITHUB_TOKEN=your_token
python evaluation/tools/build_gold_set.py \
  --input evaluation/input/pr_targets.json \
  --output evaluation/data/gold_pr_set.jsonl
```

Expected output:

- `evaluation/data/gold_pr_set.jsonl`
- Each row contains filtered file diffs and normalized human findings

## 3) Build Seeded set automatically

```bash
python evaluation/tools/build_seeded_set.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --catalog evaluation/config/seeded_mutations.json \
  --output evaluation/data/seeded_set.jsonl \
  --multiplier 2
```

Expected output:

- `evaluation/data/seeded_set.jsonl`
- Each row includes one must-find issue with category/severity/line metadata

## 4) Run your review agents against both sets

Use your existing Langflow/agent pipeline to produce structured review output.

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
python evaluation/tools/score_evaluation.py \
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
- Mutation injection now supports Front-end, Rails, and Spring Boot patterns, and can be extended further in `seeded_mutations.json`.
