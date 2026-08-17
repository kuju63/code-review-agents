#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
EVAL_DIR="$ROOT_DIR/evaluation"

PROFILE="default"
STACK_INPUTS=(
  "$EVAL_DIR/input/pr_targets_react.json"
  "$EVAL_DIR/input/pr_targets_vue.json"
  "$EVAL_DIR/input/pr_targets_angular.json"
  "$EVAL_DIR/input/pr_targets_svelte.json"
)
SEEDED_INPUTS=(
  "$EVAL_DIR/input/seeded_pr_targets_react.json"
  "$EVAL_DIR/input/seeded_pr_targets_vue.json"
  "$EVAL_DIR/input/seeded_pr_targets_angular.json"
  "$EVAL_DIR/input/seeded_pr_targets_svelte.json"
)
TARGETS_OUTPUT="$EVAL_DIR/data/pr_targets.json"
GOLD_OUTPUT="$EVAL_DIR/data/gold_pr_set.jsonl"
SEEDED_OUTPUT="$EVAL_DIR/data/seeded_set.jsonl"

LIMIT=""
LIMIT_EXPLICIT=0
SAMPLE_N=15
SAMPLE_N_EXPLICIT=0
SEED=42
MIN_SEVERITY="medium"
IMPACT=""
PRIORITY=""
BALANCED=1

SKIP_SELECT=0
SKIP_GOLD=0
SKIP_SEEDED=0

usage() {
  cat <<'EOF'
Usage:
  bash evaluation/tools/run_evaluation_pipeline.sh [options]

Options:
  --profile <default|security>       Selection profile (default: default)
  --stack-inputs <csv>               Per-stack Gold target JSON paths
  --seeded-inputs <csv>              seeded_pr_targets_{stack}.json paths
  --targets-output <path>            Output execution target JSON path
  --gold-output <path>               Gold JSONL output path
  --seeded-output <path>             Seeded JSONL output path
  --sample-n <n>                     Randomly sample n targets, stratified 50/50 by
                                      repo_type (default: 15). Mutually exclusive
                                      with --limit.
  --seed <n>                         Random seed for --sample-n (default: 42)
  --limit <n>                        Deterministic severity-ranked selection of n
                                      targets. Mutually exclusive with --sample-n.
  --min-severity <level>             Minimum severity: low, medium, high, critical
                                      (default: medium)
  --impact <csv>                     Impact filter: security, correctness,
                                      performance, maintainability
  --priority <csv>                   Priority filter: low, medium, high
  --no-balanced                      Disable balanced stack selection
  --skip-select                      Skip per-stack target selection step
  --skip-gold                        Skip Gold build step
  --skip-seeded                      Skip Seeded build step
  --help                             Show this help

Notes:
  - Gold build requires GITHUB_TOKEN.
  - Seeded build also requires GITHUB_TOKEN: it fetches real PRs from the
    dedicated seed repositories (kuju63/{stack}-seeded), it does not derive
    from the Gold set. --sample-n/--limit/--min-severity/--impact/--priority
    only affect Gold selection; the Seeded set is always built from all
    entries in --seeded-inputs (see
    docs/eval-seeded-repo-based-generation-spec.md).
  - This script prepares datasets; it does not run or score the review agent.
  - The default uses --sample-n. Use --limit for deterministic weekly or
    release-gate runs (EVALUATION_PLAN.md section 5.1).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --stack-inputs)
      IFS=',' read -r -a STACK_INPUTS <<< "$2"
      shift 2
      ;;
    --seeded-inputs)
      IFS=',' read -r -a SEEDED_INPUTS <<< "$2"
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
    --min-severity)
      MIN_SEVERITY="$2"
      shift 2
      ;;
    --impact)
      IMPACT="$2"
      shift 2
      ;;
    --priority)
      PRIORITY="$2"
      shift 2
      ;;
    --no-balanced)
      BALANCED=0
      shift
      ;;
    --skip-select)
      SKIP_SELECT=1
      shift
      ;;
    --skip-gold)
      SKIP_GOLD=1
      shift
      ;;
    --skip-seeded)
      SKIP_SEEDED=1
      shift
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

if [[ "$PROFILE" == "security" && -z "$IMPACT" ]]; then
  IMPACT="security"
fi

if [[ "$LIMIT_EXPLICIT" -eq 1 && "$SAMPLE_N_EXPLICIT" -eq 1 ]]; then
  echo "ERROR: --limit and --sample-n are mutually exclusive." >&2
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

if [[ "$SKIP_SELECT" -eq 0 ]]; then
  echo "[1/3] Selecting execution targets from per-stack inputs..."
  SELECT_ARGS=(
    nix develop --command pnpm --filter @code-review-agent/evaluation run select-stack-targets
    --inputs "${STACK_INPUTS[@]}"
    --output "$TARGETS_OUTPUT"
    --limit "$EFFECTIVE_LIMIT"
    --min-severity "$MIN_SEVERITY"
    --print-summary
  )

  if [[ "$BALANCED" -eq 1 ]]; then
    SELECT_ARGS+=(--balanced)
  fi
  if [[ -n "$IMPACT" ]]; then
    SELECT_ARGS+=(--impact "$IMPACT")
  fi
  if [[ -n "$PRIORITY" ]]; then
    SELECT_ARGS+=(--priority "$PRIORITY")
  fi
  if [[ "$USE_STRATIFIED" -eq 1 ]]; then
    SELECT_ARGS+=(--shuffle --seed "$SEED" --stratify-repo-type)
    echo "  (sampling mode: n=$EFFECTIVE_LIMIT, stratified by repo_type, seed=$SEED)"
  fi

  "${SELECT_ARGS[@]}"
else
  echo "[1/3] Skipped target selection step."
fi

if [[ "$SKIP_GOLD" -eq 0 ]]; then
  echo "[2/3] Building Gold set..."
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "GITHUB_TOKEN is required for Gold build step." >&2
    exit 3
  fi
  nix develop --command pnpm --filter @code-review-agent/evaluation run build-gold-set \
    --input "$TARGETS_OUTPUT" \
    --output "$GOLD_OUTPUT"
else
  echo "[2/3] Skipped Gold build step."
fi

if [[ "$SKIP_SEEDED" -eq 0 ]]; then
  echo "[3/3] Building Seeded set from dedicated seed repositories..."
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "GITHUB_TOKEN is required for Seeded build step." >&2
    exit 3
  fi
  nix develop --command pnpm --filter @code-review-agent/evaluation run build-seeded-set \
    --targets "${SEEDED_INPUTS[@]}" \
    --output "$SEEDED_OUTPUT"
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
1. Run the review agent and produce evaluation/data/agent_predictions.jsonl
   (the A2A server must already be running; see .claude/skills/run-evaluation/SKILL.md).
   packages/evaluation has no "run-agent-evaluation" package.json script yet
   (pre-existing gap from Issue #306/#307), so invoke tsx directly:
   nix develop --command pnpm --filter @code-review-agent/evaluation exec tsx \
     src/run-agent-evaluation.ts \
     --gold $GOLD_OUTPUT \
     --seeded $SEEDED_OUTPUT \
     --pred evaluation/data/agent_predictions.jsonl \
     --base-url http://localhost:8000 \
     --concurrency 2
2. Score results and generate the report + Discord notification
   (run-agent-evaluation no longer invokes this automatically, unlike the
   retired Python runner):
   nix develop --command pnpm --filter @code-review-agent/evaluation run generate-evaluation-report \
     --gold $GOLD_OUTPUT \
     --seeded $SEEDED_OUTPUT \
     --pred evaluation/data/agent_predictions.jsonl

[COVERAGE-WARN] messages are advisory and do not stop the pipeline.
Review composition before using a --sample-n run as a release-gate signal.
EOF
