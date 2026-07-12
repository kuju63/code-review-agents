# Coding Conventions

- PEP 8, full type hints, Google-style docstrings (see `register_reviewer` in `agents/registry.py` for the house style: `Args:`/`Returns:` sections, comment on *why* a decorator preserves the concrete type).
- One module = one responsibility — this repo splits transport (`api/agents/*`) from behavior (`agents/*`) rather than mixing them; follow that split for new agents (see `mem:architecture`).
- New reviewers: add under `agents/reviewers/`, decorate with `@register_reviewer`, declare `perspective`/`project_types`; never hard-code reviewer dispatch in `ReviewOrchestrator`.
- Extending stack detection: update `detect_project_types` in `agents/registry.py` AND `tests/agents/test_registry.py` together.
- Tests mirror `src/` package layout under `tests/` (e.g. `agents/reviewers/frontend.py` behavior tested via `tests/agents/test_reviewers.py`, `a2a/models.py` via `tests/a2a/test_models.py`).
- Commit messages: write in English (Japanese is fine in chat/docs); not currently enforced by tooling, but the preferred practice for this repo.
- Branch ops: prefer `git switch -c` to create and `git switch` to change branches over `git checkout -b`/`git checkout`.
- Doc/spec discipline: any feature add/change requires a doc under `docs/` (design/spec) — check `docs/adr/` for existing accepted decisions before proposing a new architecture direction.
