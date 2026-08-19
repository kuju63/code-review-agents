# Coding Conventions

- Biome enforces the code style (formatting + lint) — see `pnpm exec biome check`. Documentation comments are TSDoc only (not JSDoc). Write a comment only when the WHY is non-obvious (hidden constraint, subtle invariant, workaround); don't restate WHAT the code does — see `registry.ts`/`review-orchestrator.ts` for the house style.
- New reviewers: add under `packages/agent-core/src/agents/reviewers/`, call `registerReviewer(cls)` as a plain function at the bottom of the module (not a decorator), declare `perspective`/`projectTypes` on the class, and add a re-export in `reviewers/index.ts` so the registration side effect actually runs. Never hard-code reviewer dispatch in `ReviewOrchestrator`.
- Extending stack detection: update `detectProjectTypes` in `packages/agent-core/src/agents/registry.ts` AND `registry.test.ts` together.
- Tests are co-located with implementation as `*.test.ts` in the same directory (e.g. `registry.ts` + `registry.test.ts`, `reviewers/svelte.ts` + `reviewers/svelte.test.ts`) — not mirrored under a separate `tests/` tree like the old Python layout.
- Commit messages: write in English (Japanese is fine in chat/docs).
- Branch ops: prefer `git switch -c` to create and `git switch` to change branches over `git checkout -b`/`git checkout`.
- Doc/spec discipline: any feature add/change requires a doc under `docs/` (design/spec) — check `docs/adr/` for existing accepted decisions before proposing a new architecture direction.
