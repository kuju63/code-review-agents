# Code Review Agent — Core Map

Python 3.12+ agent that reviews GitHub PRs via Strands Agents + GitHub MCP, exposed over an A2A HTTP API. See `AGENTS.md`/`CLAUDE.md` at repo root for the mandatory Spec-Driven+TDD workflow and checklist — that is process, not covered here.

## Source map (`src/code_review_agent/`)

- `agents/` — core, framework-agnostic agent logic (PR collector, orchestrator, lead engineer, reviewer registry/base classes). Details: `mem:architecture`.
- `api/` — FastAPI app exposing each core agent as an A2A HTTP endpoint (`api/agents/*` are thin adapters over `agents/*`). Details: `mem:architecture`.
- `a2a/` — A2A protocol layer: pydantic wire models (`models.py`), input sanitizers, in-memory task store.
- `models/` — shared pydantic domain models (PR info, review, lead-engineer verdict) used across agents/api.
- `skills/` — `agent_skills_factory.py`, builds Strands `AgentSkills` from `strands-agents-tools`.
- `tools/github_mcp.py` — GitHub MCP (read-only) client wiring.

`evaluation/` holds the offline eval pipeline (gold/seeded PR sets, scoring, RUNBOOK/EVALUATION_PLAN) — treat `evaluation/EVALUATION_PLAN.md` as the source of truth for whether a feature requirement counts as "verified" (per CLAUDE.md policy).

`docs/adr/` has accepted architecture decisions; `docs/*-spec.md` and `plan/*.md` are per-feature specs — check these before assuming a design is undocumented.

Other memories: `mem:tech_stack`, `mem:suggested_commands`, `mem:conventions`, `mem:task_completion`.
