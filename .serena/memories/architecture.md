# Agent Architecture

## Layering

- `packages/agent-core/src/agents/*.ts` (`pr-info-collector.ts`, `review-orchestrator.ts`, `lead-engineer.ts`, `base-reviewer.ts`, `registry.ts`) contain the actual agent behavior, independent of transport. Unlike the old Python version there is no separate `api/agents/*` FastAPI adapter layer — the core classes are invoked more or less directly.
- `packages/a2a-server/` (Hono, `@hono/node-server`) is the thin HTTP layer exposing each core agent as an A2A endpoint (`src/index.ts`). Prefer invoking agents through the A2A HTTP API rather than importing and calling the core classes directly, so validation/auth at that layer isn't bypassed.

## Reviewer plugin pattern (`packages/agent-core/src/agents/registry.ts` + `base-reviewer.ts`)

- New specialist reviewers live under `packages/agent-core/src/agents/reviewers/` (e.g. `react.ts`, `angular.ts`, `svelte.ts`, `vue.ts`, `security.ts`) and self-register by calling `registerReviewer(cls)` as a plain function call at the bottom of the module — NOT a decorator (`export function registerReviewer<T extends ReviewerClass>(cls: T): T` in `registry.ts`). `reviewers/index.ts` re-exports every reviewer class so importing it triggers all the registration side effects.
- `ReviewerClass` (`base-reviewer.ts`) is the base type; reviewers declare scope via `perspective` and `projectTypes` static properties.
- `detectProjectTypes` in `registry.ts` maps a PR's changed files to applicable `ProjectType`s in three tiers, each returning immediately on a match: (1) `DETECTION_RULES` — manifest-name/file-extension rules for Angular/Svelte/Vue; (2) content-based detection via `collectDirectPackageNames`/`detectProjectTypeFromPackages` (manifest file contents) — resolves metaframeworks (Next.js→React, Nuxt→Vue) that share their base framework's extensions; (3) coarse fallback — `package.json` or generic `.ts`/`.tsx`/`.js`/`.jsx` changes assumed React/TypeScript. Extend this (plus `registry.test.ts`) when adding stack support, per CLAUDE.md.
- `getReviewerClasses(projectType, perspectives?)` in `registry.ts` selects applicable reviewer classes, including metaframework base-type fallback.
- `ReviewOrchestrator` (`review-orchestrator.ts`) discovers reviewers via the registry and runs them in parallel — do not hard-code reviewer selection in the orchestrator itself.
