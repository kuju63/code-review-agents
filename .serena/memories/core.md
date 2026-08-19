# Code Review Agent — Core Map

TypeScript (Node >=24) agent that reviews GitHub PRs via Strands Agents + GitHub MCP, exposed over an A2A HTTP API. See `AGENTS.md`/`CLAUDE.md` at repo root for the mandatory Spec-Driven+TDD workflow and checklist — that is process, not covered here. Issue #255 completed the Python→TypeScript migration; the former `src/code_review_agent/` tree has been removed.

## Source map (`packages/`)

- `packages/agent-core/src/agents/` — core agent logic: `pr-info-collector.ts`, `review-orchestrator.ts`, `lead-engineer.ts`, `base-reviewer.ts`, `registry.ts` (reviewer registration + project-type detection), plus `reviewers/` (`angular.ts`, `react.ts`, `security.ts`, `svelte.ts`, `vue.ts`). Details: `mem:architecture`.
- `packages/agent-core/src/tools/github-mcp.ts` — GitHub MCP (read-only) client wiring.
- `packages/agent-core/src/models/` — shared domain types (PR info, review, lead-engineer verdict) used across agents/API.
- `packages/a2a-server/` — Hono-based A2A HTTP API (`src/index.ts`) exposing the core agents over HTTP.

`evaluation/` holds the offline eval pipeline (gold/seeded PR sets, scoring, RUNBOOK/EVALUATION_PLAN) — treat `evaluation/EVALUATION_PLAN.md` as the source of truth for whether a feature requirement counts as "verified" (per CLAUDE.md policy).

`docs/adr/` has accepted architecture decisions; `docs/*-spec.md` and `plan/*.md` are per-feature specs — check these before assuming a design is undocumented.

Other memories: `mem:tech_stack`, `mem:suggested_commands`, `mem:conventions`, `mem:task_completion`, `mem:architecture`.
