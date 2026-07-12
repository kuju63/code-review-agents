# Task Completion Checklist

A coding task is not done until, in order:

1. `uv run pytest` passes.
2. `uv run ruff check` passes (no lint errors).
3. `uv run ruff format --check` passes (no formatting diffs).
4. Test coverage >= 75% (project quality gate, per CONTRIBUTING.md / CLAUDE.md).
5. If the task changed requirement coverage, `evaluation/EVALUATION_PLAN.md` is updated before relying on `evaluation/RUNBOOK.md` to re-verify.
6. If the change adds/changes a feature, a corresponding doc under `docs/` exists or was updated (mandatory, not optional, per CONTRIBUTING.md).

`pre-commit run --all-files` additionally runs betterleaks (secret scan), pyright, and pymarkdown (for `*.md`) — not covered by the `uv run` commands above but required before commit since hooks are installed via `pre-commit install`.

Full process gates (spec-before-code, rollback commits, PR template) are defined in root `CLAUDE.md`/`AGENTS.md` — this memory only covers the final validation commands, not the whole workflow.
