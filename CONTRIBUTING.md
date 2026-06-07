# Contributing Guide

This document defines the contribution workflow for this repository.

## 1. Principles

- For bug fixes and feature requests, always create an Issue before starting implementation.
- For large changes, align on objective, background, and impact scope in the Issue before implementation.
- The development process uses **Spec-Driven + TDD** as described in this document.
- For any feature addition or feature change, you must create or update the related documentation under `docs/`.

## 2. Development Flow (Spec-Driven + TDD)

1. Create an Issue

   - Bug fix: include reproduction steps, expected result, actual result, and environment details.
   - Feature request: include user value, acceptance criteria, and non-functional requirements when needed.

2. Clarify requirements and keep the spec in files

   - Define requirements, boundary conditions, and exception scenarios.
   - Update existing documents in `plan/` and `docs/` as needed.
   - For feature additions or changes, creating or updating the related document in `docs/` is mandatory.

3. Implement with TDD

   - Write tests first (Red).
   - Implement the minimum change to pass tests (Green).
   - Refactor and re-validate (Refactor).

4. Meet quality gates

   - Requirements are satisfied.
   - All tests pass.
   - Test coverage is at least 75%.

5. Create a Pull Request and address review feedback

   - Link the related Issue in the PR.
   - After feedback updates, re-run test/lint/format and update the branch.

## 3. Local Development Commands

### Initial setup

```bash
uv venv
source .venv/bin/activate
uv sync
pre-commit install
```

### Test

```bash
uv run pytest
```

### Lint and format

```bash
uv run ruff check
uv run ruff check --fix
uv run ruff format
uv run ruff format --check
```

### Build

```bash
uv build
```

## 4. Implementation and Design Rules

- Follow PEP 8.
- Add type hints.
- Keep one module focused on one responsibility.
- Use Google-style doc comments.
- Keep line comments focused on why/what, and avoid obvious comments.

## 5. PR Description Rules

- Write PR descriptions using `.github/pull_request_template.md`.
- At minimum, always complete the following sections:
- Summary
- Change Details
- Impact Scope
- Related Issue
- Test Results
- Documentation Updates
- Risk and Rollback

## 6. References

- Requirement criteria: `evaluation/EVALUATION_PLAN.md`
- Evaluation procedure: `evaluation/RUNBOOK.md`
