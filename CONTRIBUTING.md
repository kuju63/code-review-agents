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

Local commands need the TypeScript toolchain (Node, pnpm, biome) provided by the
repository-root Nix flake; prefix commands with `nix develop --command` when it
is not already active in your shell. See `CLAUDE.md` for details.

### Initial setup

```bash
nix develop --command pnpm install --frozen-lockfile
pre-commit install
```

### Test

```bash
nix develop --command pnpm run test
```

### Lint and format

```bash
nix develop --command pnpm run lint
nix develop --command pnpm exec biome check --write .
nix develop --command pnpm exec biome format --write .
```

### Type check

```bash
nix develop --command pnpm run typecheck
```

## 4. Implementation and Design Rules

- Follow the Biome-enforced style (`pnpm run lint`); do not hand-format around it.
- Use explicit TypeScript types; avoid `any`.
- Keep one module focused on one responsibility.
- Use TSDoc-style doc comments.
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
