# Agent Architecture

## Layering: agents/ vs api/agents/ vs a2a/

- `agents/*.py` (`pr_info_collector.py`, `review_orchestrator.py`, `lead_engineer.py`, `base_reviewer.py`, `registry.py`) contain the actual agent behavior, independent of transport.
- `api/agents/*.py` (`pr_info_collector.py`, `orchestrator.py`, `frontend_reviewer.py`, `security_reviewer.py`, `lead_engineer.py`) are thin FastAPI/A2A adapters — one per core agent, wired via `api/agents/common.py` (`ReviewerSkillInput`/`LeadEngineerSkillInput`, `verify_github_token`). `api/app.py:create_app` assembles the FastAPI app from these.
- `a2a/models.py` defines the A2A protocol wire types (`A2ATask`, `A2AMessage`, `AgentCard`, etc.) shared by all `api/agents/*` adapters; `a2a/sanitizers.py` and `a2a/task_store.py` are supporting infra.
- Per `mem:core` project memory / CLAUDE.md convention: **agents must be invoked via the A2A HTTP API**, never by importing and calling the core `agents/*` classes directly — the api layer performs auth/sanitization the core layer does not.

## Reviewer plugin pattern (`agents/registry.py` + `agents/base_reviewer.py`)

- New specialist reviewers live under `agents/reviewers/` (e.g. `frontend.py`, `security.py`) and self-register via the `@register_reviewer` class decorator (appends to module-level `_REGISTRY`).
- `ReviewAgent`/`LLMReviewAgent` (`base_reviewer.py`) are the base classes; reviewers declare scope via `perspective` and `project_types` class metadata.
- `detect_project_types` in `registry.py` maps a PR's changed files to applicable project types — extend this (plus `tests/agents/test_registry.py`) when adding stack support, per CLAUDE.md.
- `ReviewOrchestrator` (`agents/review_orchestrator.py`) discovers reviewers via `get_reviewer_classes`/`get_registered_reviewers` and runs them in parallel — do not hard-code reviewer selection in the orchestrator itself.
