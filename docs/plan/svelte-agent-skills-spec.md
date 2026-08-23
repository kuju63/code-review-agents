# Svelte Agent Skills Implementation Plan

Design: [docs/svelte-agent-skills-spec.md](../svelte-agent-skills-spec.md)

## Operating Constraints (Python-era workflow record)

All implementation work for this feature happens in a dedicated Git worktree
under `.claude/worktrees/`.

Documentation is written and committed before implementation starts. Commits are
split at logical rollback points:

1. Spec baseline plus vendored skill.
2. Empty implementation stubs plus Red tests.
3. Minimal Green implementation.
4. Refactor plus final validation.

The TDD cycle for this feature uses an empty implementation before running the
Red tests. The required order is:

1. Create empty implementation stubs.
2. Add tests that describe the intended behavior.
3. Run tests and confirm they fail against the stubs.
4. Implement the minimum behavior to pass.
5. Run tests and confirm Green.
6. Refactor while preserving behavior.
7. Re-run validation.

Any new or updated Python docstring must use Google Style. No other docstring
format is permitted. (The current TS implementation uses TSDoc conventions
instead; see [CONTRIBUTING.md](../../CONTRIBUTING.md).)

## Tests

The feature is verified by unit tests covering these behaviors:

1. `AgentSkillType.SVELTE_REVIEW` resolves four skills including
   `svelte-core-bestpractices`.
2. The vendored Svelte references are available on disk.
3. The vendored `SKILL.md` is adapted for review.
4. `ProjectType.SVELTE` exists and serializes as `"svelte"`.
5. `detectProjectTypes()` returns Svelte for a `.svelte` file change.
6. `detectProjectTypes()` returns Svelte for a `svelte.config.js`/`.ts` signal.
7. Svelte detection suppresses coarse React/TypeScript detection.
8. Angular detection retains priority over Svelte.
9. `SvelteReviewer` is registered and selected for `ProjectType.SVELTE`.
10. `SecurityReviewer` is selected for `ProjectType.SVELTE`.
11. `SvelteReviewer.review()` returns an empty result without invoking the LLM
    for a non-Svelte PR.
12. `PRInfoCollector` treats `svelte.config.js`/`.ts` as dependency files.

## Validation

Final validation runs:

```bash
pnpm exec tsc --noEmit
pnpm exec biome check
pnpm run test
```

Coverage must remain at or above 75% for the final quality gate.
