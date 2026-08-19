# Task Completion Checklist

A coding task is not done until, in order:

1. `nix develop --command pnpm exec tsc --noEmit` passes.
2. `nix develop --command pnpm exec biome check --no-errors-on-unmatched` passes (no lint/format errors).
3. `nix develop --command pnpm run test` passes.
4. Test coverage >= 75% on lines/functions/branches/statements (`vitest.config.ts` thresholds; project quality gate, per CONTRIBUTING.md / CLAUDE.md).
5. If the task changed requirement coverage, `evaluation/EVALUATION_PLAN.md` is updated before relying on `evaluation/RUNBOOK.md` to re-verify.
6. If the change adds/changes a feature, a corresponding doc under `docs/` exists or was updated (mandatory, not optional, per CONTRIBUTING.md).

`pre-commit run --all-files` additionally runs betterleaks (secret scan), pymarkdown (for `*.md`), `no-commit-to-branch`, and `lint-staged (biome)` — not covered by the commands above but required before commit since hooks are installed via `.pre-commit-config.yaml` (husky dependency was removed; pre-commit remains the permanent hook entry point — see `mem:suggested_commands`). No pyright/pytest — that was the removed Python-era tooling.

Full process gates (spec-before-code, rollback commits, PR template) are defined in root `CLAUDE.md`/`AGENTS.md` — this memory only covers the final validation commands, not the whole workflow.
