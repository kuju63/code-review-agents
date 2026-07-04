#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
EVAL_DIR="$ROOT_DIR/evaluation"

PROFILE="default"
TAGGED_INPUT="$EVAL_DIR/input/pr_targets_b2b2c_tagged.json"
TARGETS_OUTPUT="$EVAL_DIR/data/pr_targets.json"
GOLD_OUTPUT="$EVAL_DIR/data/gold_pr_set.jsonl"
SEEDED_OUTPUT="$EVAL_DIR/data/seeded_set.jsonl"

LIMIT=""
LIMIT_EXPLICIT=0
SAMPLE_N=15
SAMPLE_N_EXPLICIT=0
SEED=42
MIN_RISK="medium"
BALANCED=1
THEMES_ANY=""
SEEDED_MULTIPLIER=2

SKIP_CONVERT=0
SKIP_GOLD=0
SKIP_SEEDED=0

usage() {
  cat <<'EOF'
Usage:
  bash evaluation/tools/run_evaluation_pipeline.sh [options]

Options:
  --profile <default|security>   Selection profile (default: default)
  --tagged-input <path>          Tagged PR candidate JSON path
  --targets-output <path>        Output execution target JSON path (default: evaluation/data/pr_targets.json)
  --gold-output <path>           Gold JSONL output path
  --seeded-output <path>         Seeded JSONL output path
  --sample-n <n>                 Randomly sample n targets, stratified 50/50 by
                                  repo_type (default: 15). Fast path for local
                                  iteration. Mutually exclusive with --limit.
  --seed <n>                     Random seed for --sample-n (default: 42)
  --limit <n>                    Deterministic risk-ranked selection of n targets
                                  (legacy path, used for weekly/release-gate runs).
                                  Mutually exclusive with --sample-n.
  --min-risk <low|medium|high>   Minimum risk filter (default: medium)
  --themes-any <csv>             Theme filter (example: security,tenant,isolation,auth)
  --seeded-multiplier <n>        Seeded items per Gold item (default: 2)
  --no-balanced                  Disable balanced stack selection
  --skip-convert                 Skip tagged->targets conversion step
  --skip-gold                    Skip Gold build step
  --skip-seeded                  Skip Seeded build step
  --help                         Show this help

Notes:
  - Gold step requires GITHUB_TOKEN.
  - This script does not run your review agent and does not score; it prepares datasets.
  - Default behavior (no --limit given) uses --sample-n: a randomized,
    repo_type-stratified subset. Use --limit for full/deterministic runs
    (weekly refresh, release-gate evaluation per EVALUATION_PLAN.md §5.1).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --tagged-input)
      TAGGED_INPUT="$2"
      shift 2
      ;;
    --targets-output)
      TARGETS_OUTPUT="$2"
      shift 2
      ;;
    --gold-output)
      GOLD_OUTPUT="$2"
      shift 2
      ;;
    --seeded-output)
      SEEDED_OUTPUT="$2"
      shift 2
      ;;
    --limit)
      LIMIT="$2"
      LIMIT_EXPLICIT=1
      shift 2
      ;;
    --sample-n)
      SAMPLE_N="$2"
      SAMPLE_N_EXPLICIT=1
      shift 2
      ;;
    --seed)
      SEED="$2"
      shift 2
      ;;
    --min-risk)
      MIN_RISK="$2"
      shift 2
      ;;
    --themes-any)
      THEMES_ANY="$2"
      shift 2
      ;;
    --seeded-multiplier)
      SEEDED_MULTIPLIER="$2"
      shift 2
      ;;
    --no-balanced)
      BALANCED=0
      shift 1
      ;;
    --skip-convert)
      SKIP_CONVERT=1
      shift 1
      ;;
    --skip-gold)
      SKIP_GOLD=1
      shift 1
      ;;
    --skip-seeded)
      SKIP_SEEDED=1
      shift 1
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$PROFILE" == "security" && -z "$THEMES_ANY" ]]; then
  THEMES_ANY="security,tenant,isolation,auth,access_control,pii"
fi

if [[ "$LIMIT_EXPLICIT" -eq 1 && "$SAMPLE_N_EXPLICIT" -eq 1 ]]; then
  echo "ERROR: --limit and --sample-n are mutually exclusive. Use --limit for legacy/full runs, --sample-n for fast randomized runs." >&2
  exit 2
fi

if [[ "$LIMIT_EXPLICIT" -eq 1 ]]; then
  USE_STRATIFIED=0
  EFFECTIVE_LIMIT="$LIMIT"
else
  USE_STRATIFIED=1
  EFFECTIVE_LIMIT="$SAMPLE_N"
fi

mkdir -p "$(dirname "$TARGETS_OUTPUT")" "$(dirname "$GOLD_OUTPUT")" "$(dirname "$SEEDED_OUTPUT")"

if [[ "$SKIP_CONVERT" -eq 0 ]]; then
  echo "[1/3] Converting tagged PR candidates into execution targets..."
  CONVERT_ARGS=(
    python "$EVAL_DIR/tools/convert_tagged_targets.py"
    --input "$TAGGED_INPUT"
    --output "$TARGETS_OUTPUT"
    --limit "$EFFECTIVE_LIMIT"
    --min-risk "$MIN_RISK"
    --print-summary
  )

  if [[ "$BALANCED" -eq 1 ]]; then
    CONVERT_ARGS+=(--balanced)
  fi
  if [[ -n "$THEMES_ANY" ]]; then
    CONVERT_ARGS+=(--themes-any "$THEMES_ANY")
  fi

  if [[ "$USE_STRATIFIED" -eq 1 ]]; then
    CONVERT_ARGS+=(--shuffle --seed "$SEED" --stratify-repo-type)
    echo "  (fast sampling mode: n=$EFFECTIVE_LIMIT, stratified by repo_type, seed=$SEED)"
  fi

  "${CONVERT_ARGS[@]}"
else
  echo "[1/3] Skipped conversion step."
fi

if [[ "$SKIP_GOLD" -eq 0 ]]; then
  echo "[2/3] Building Gold set..."
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "GITHUB_TOKEN is required for Gold build step." >&2
    exit 3
  fi
  python "$EVAL_DIR/tools/build_gold_set.py" \
    --input "$TARGETS_OUTPUT" \
    --output "$GOLD_OUTPUT"
else
  echo "[2/3] Skipped Gold build step."
fi

if [[ "$SKIP_SEEDED" -eq 0 ]]; then
  echo "[3/3] Building Seeded set..."
  python "$EVAL_DIR/tools/build_seeded_set.py" \
    --gold "$GOLD_OUTPUT" \
    --catalog "$EVAL_DIR/config/seeded_mutations.json" \
    --output "$SEEDED_OUTPUT" \
    --multiplier "$SEEDED_MULTIPLIER"
else
  echo "[3/3] Skipped Seeded build step."
fi

cat <<EOF

Done.

Generated files:
- $TARGETS_OUTPUT
- $GOLD_OUTPUT
- $SEEDED_OUTPUT

Next steps:
1. Run your review agent and produce evaluation/data/agent_predictions.jsonl
   (python evaluation/tools/run_agent_evaluation.py ... --concurrency 2)
2. Score results:
   python evaluation/tools/score_evaluation.py \
     --gold $GOLD_OUTPUT \
     --seeded $SEEDED_OUTPUT \
     --pred evaluation/data/agent_predictions.jsonl

-------------------------------------------------------------
NOTE: [COVERAGE-WARN] lines above (if any) are non-blocking
(see EVALUATION_PLAN.md section 2.0 / 2.0.3). The pipeline continues
regardless; review composition before using a --sample-n run
as a release-gate signal.
-------------------------------------------------------------
EOF
