# Correctness checks

## Contents
- Intent alignment
- Edge cases
- Async failure paths
- Race conditions
- Test coverage

---

## Intent alignment

Compare `PR_TITLE` + `PR_BODY` against the actual diff.

- Diff contains changes unrelated to stated intent → 🟡 (scope creep)
- Stated fix is absent from the diff → 🔴

## Edge cases

Scan added lines for unguarded access:

- Array access without bounds check (prefer `.at(0)` or optional chaining)
- Object property access on a potentially-null value
- Division without zero-check
- String methods on non-string types (without type guards)

Severity: 🔴 in hot path or data-fetching result handler, 🟡 otherwise

## Async failure paths

For every `fetch`, `axios`, `useQuery`, `useSWR`, `$fetch`, `load()`, or similar:

- Error state rendered to the user? → missing = 🟡
- Error silently swallowed (empty catch, no log)? → 🔴
- Loading state present? → missing = 🟡

## Race conditions

Flag concurrent async calls where:

- An earlier response could overwrite a later one
- Component unmounts before async completes (no AbortController / cancellation)

Severity: 🔴

## Test coverage

Logic changed but no test file added or modified → 🟡
Exception: pure UI changes with no branching logic

## Issue format

```
**[CORRECTNESS] Short title**
File: `path/to/file` (line N)
Why it matters: {one sentence — the actual risk}
Suggestion: {concrete fix with code snippet when helpful}
```
