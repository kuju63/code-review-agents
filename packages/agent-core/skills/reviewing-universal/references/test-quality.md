# Test quality checks

## Contents
- Behavior vs implementation detail
- Test isolation
- Assertion presence
- Coverage of changed paths

---

## Behavior vs implementation detail

Tests asserting on internal state (component instance variables, store internals,
private methods) rather than rendered output or user-observable behavior.

Severity: 🟡

Ref: https://kentcdodds.com/blog/testing-implementation-details

## Test isolation

Tests sharing mutable state across `it()` / `test()` blocks without reset
in `beforeEach` / `afterEach`.

Severity: 🟡

## Assertion presence

Test cases with no `expect()` / `assert()` calls — may be incomplete.

Severity: 🟢

## Coverage of changed paths

Cross-reference with correctness.md findings: if missing tests were flagged,
confirm here whether the test file in the diff covers those new branches.

Severity: 🟡 if coverage gap persists

## Issue format

```
**[TEST] Short title**
File: `path/to/file.test.ts` (line N)
Why it matters: {false confidence or missing coverage risk}
Suggestion: {concrete rewrite example}
```
