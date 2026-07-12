# Suggested Commands

## Setup

```bash
uv venv
source .venv/bin/activate
uv sync
pre-commit install   # requires `betterleaks` installed (brew install betterleaks) for the secret-scan hook
```

## Test / Lint / Format / Type-check

```bash
uv run pytest
uv run ruff check
uv run ruff check --fix
uv run ruff format
uv run ruff format --check
```
Pyright and pymarkdown (docs) run via `pre-commit run --all-files`, not as standalone `uv run` commands.

## Run

```bash
uv run code-review-agent   # CLI entrypoint is currently a placeholder ("Hello from code-review-agent!")
```
Real usage is the FastAPI A2A app (`api/app.py:create_app`), typically run via Docker/Podman — see README "Using Podman" section.

## Evaluation pipeline

```bash
bash evaluation/tools/run_evaluation_pipeline.sh
python evaluation/tools/score_evaluation.py --gold evaluation/data/gold_pr_set.jsonl --seeded evaluation/data/seeded_set.jsonl --pred evaluation/data/agent_predictions.jsonl
```

## Darwin-specific notes

- No GNU-vs-BSD command differences currently relied upon in this repo's scripts; `find`/`grep` as used here behave the same. `betterleaks` and `pre-commit` are installed via Homebrew on this machine.

## Worktrees (project convention, not a generic git op)

```bash
WORKTREE_ROOT=$(git rev-parse --show-toplevel)
PROJECT_ROOT=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
mkdir -p "$WORKTREE_ROOT/.claude"
[ -f "$PROJECT_ROOT/.claude/settings.local.json" ] && cp "$PROJECT_ROOT/.claude/settings.local.json" "$WORKTREE_ROOT/.claude/"
[ -f "$PROJECT_ROOT/.env" ] && ln -sf "$PROJECT_ROOT/.env" "$WORKTREE_ROOT/.env"
```
`.env` must be a symlink, not a copy, per CLAUDE.md.
