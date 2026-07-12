# Agent Architecture

## Layering: agents/ vs api/agents/ vs a2a/

- `src/code_review_agent/agents/*.py` (`pr_info_collector.py`, `review_orchestrator.py`, `lead_engineer.py`, `base_reviewer.py`, `registry.py`) contain the actual agent behavior, independent of transport.
- `src/code_review_agent/api/agents/*.py` (`pr_info_collector.py`, `orchestrator.py`, `frontend_reviewer.py`, `security_reviewer.py`, `lead_engineer.py`) are thin FastAPI/A2A adapters — one per core agent, wired via `src/code_review_agent/api/agents/common.py` (`ReviewerSkillInput`/`LeadEngineerSkillInput`, `verify_github_token`). `src/code_review_agent/api/app.py:create_app` assembles the FastAPI app from these.
- `src/code_review_agent/a2a/models.py` defines the A2A protocol wire types (`A2ATask`, `A2AMessage`, `AgentCard`, etc.) shared by all `api/agents/*` adapters; `src/code_review_agent/a2a/sanitizers.py` and `src/code_review_agent/a2a/task_store.py` are supporting infra.
- The core `agents/*` classes have no auth/sanitization of their own — that's implemented in the `api/agents/*` adapters (`verify_github_token`, input sanitizers). Prefer invoking agents through the A2A HTTP API rather than importing and calling the core classes directly, so that layer isn't bypassed.

## Reviewer plugin pattern (`src/code_review_agent/agents/registry.py` + `agents/base_reviewer.py`)

- New specialist reviewers live under `src/code_review_agent/agents/reviewers/` (e.g. `frontend.py`, `security.py`) and self-register via the `@register_reviewer` class decorator (appends to module-level `_REGISTRY`).
- `ReviewAgent`/`LLMReviewAgent` (`base_reviewer.py`) are the base classes; reviewers declare scope via `perspective` and `project_types` class metadata.
- `detect_project_types` in `registry.py` maps a PR's changed files to applicable project types — extend this (plus `tests/agents/test_registry.py`) when adding stack support, per CLAUDE.md.
- `ReviewOrchestrator` (`src/code_review_agent/agents/review_orchestrator.py`) discovers reviewers via `get_reviewer_classes`/`get_registered_reviewers` and runs them in parallel — do not hard-code reviewer selection in the orchestrator itself.
