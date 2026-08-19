# Suggested Commands

Local dev commands need the Nix-provided toolchain — prefix with `nix develop --command` (or run inside an active `nix develop` shell) rather than assuming pnpm/biome are on the host PATH. CI does not use Nix (see CLAUDE.md §"TypeScript Toolchain").

## Setup

​```bash
nix develop --command pnpm install --frozen-lockfile
​```

## Test / Lint / Format / Type-check

​```bash
nix develop --command pnpm exec tsc --noEmit
nix develop --command pnpm exec biome check --no-errors-on-unmatched
nix develop --command pnpm run test
​```
These three (`tsc --noEmit`, `biome check`, `pnpm run test`) are the mandatory validation commands per CLAUDE.md's per-feature checklist. CI (`ci-check` job in `.github/workflows/ci.yaml`) runs the equivalent checks via root `package.json` scripts instead: `pnpm run lint` (= `biome check .`, no `--no-errors-on-unmatched` flag), `pnpm run typecheck` (= `pnpm -r --parallel exec tsc --noEmit`), `pnpm run test`.

## pre-commit hooks

`.pre-commit-config.yaml` is still the active git hook entry point (husky was evaluated and its dependency removed — `core.hooksPath` is shared across all git worktrees, so switching to husky would disable pre-commit enforcement in every other concurrently checked-out worktree). Hooks: betterleaks (secret scan), pymarkdown (`*.md`, via `.pymarkdown.json`), `no-commit-to-branch`, and `lint-staged (biome)` (runs `pnpm exec lint-staged` under Nix). No pyright/pytest — those were the Python-era hooks, now gone.

​```bash
pre-commit run --all-files
​```

## Run

​```bash
nix develop --command pnpm --filter a2a-server run dev
​```
Runs the A2A HTTP server (`packages/a2a-server/src/index.ts`, Hono) exposing the review agents. For the compiled entrypoint:
​```bash
nix develop --command pnpm --filter a2a-server run build
nix develop --command pnpm --filter a2a-server run start
​```

## Evaluation pipeline

​```bash
bash evaluation/tools/run_evaluation_pipeline.sh
nix develop --command pnpm --filter @code-review-agent/evaluation run score-evaluation \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl
​```

## Worktrees (project convention, not a generic git op)

​```bash
WORKTREE_ROOT=$(git rev-parse --show-toplevel)
PROJECT_ROOT=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
mkdir -p "$WORKTREE_ROOT/.claude"
[ -f "$PROJECT_ROOT/.claude/settings.local.json" ] && cp "$PROJECT_ROOT/.claude/settings.local.json" "$WORKTREE_ROOT/.claude/"
[ -f "$PROJECT_ROOT/.env" ] && ln -sf "$PROJECT_ROOT/.env" "$WORKTREE_ROOT/.env"
​```
`.env` must be a symlink, not a copy, per CLAUDE.md.
