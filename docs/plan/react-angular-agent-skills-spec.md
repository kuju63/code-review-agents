# React/Angular Agent Skills Implementation Plan

Design: [docs/react-angular-agent-skills-spec.md](../react-angular-agent-skills-spec.md)

## Operating Constraints (Python-era workflow record)

All implementation work for this feature must happen in a dedicated Git worktree under `.claude/worktrees/`.

Documentation must be written and committed before implementation starts. Commits must be split at logical rollback points:

1. Spec baseline.
2. Empty implementation stubs plus Red tests.
3. Minimal Green implementation.
4. Refactor plus final validation.

The TDD cycle for this feature must use an empty implementation before running the Red tests. The required order is:

1. Create empty implementation stubs.
2. Add tests that describe the intended behavior.
3. Run tests and confirm they fail against the stubs.
4. Implement the minimum behavior to pass.
5. Run tests and confirm Green.
6. Refactor while preserving behavior.
7. Re-run validation.

Any new or updated Python docstring must use Google Style. (The current TS
implementation uses TSDoc conventions instead; see [CONTRIBUTING.md](../../CONTRIBUTING.md).)

## Tests

The feature is verified by unit tests covering these behaviors:

1. `AgentSkillType.FRONTEND_REVIEW` resolves six skills including both Vercel skills.
2. `AgentSkillType.ANGULAR_REVIEW` resolves Angular-specific skills including `angular-developer`.
3. `ProjectType.ANGULAR` exists and serializes as `"angular"`.
4. `detectProjectTypes()` returns Angular for `angular.json`.
5. `detectProjectTypes()` returns Angular for Angular file naming conventions.
6. Angular detection suppresses coarse React/TypeScript detection.
7. `AngularReviewer` is registered and selected for `ProjectType.ANGULAR`.
8. `SecurityReviewer` is selected for `ProjectType.ANGULAR`.
9. `PRInfoCollector` treats `angular.json` as a dependency file.

## Validation

Final validation must run (Python-era commands; current TS equivalent is
`pnpm exec tsc --noEmit`, `pnpm exec biome check`, `pnpm run test`):

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
```

Coverage must remain at or above 75% for the final quality gate.
