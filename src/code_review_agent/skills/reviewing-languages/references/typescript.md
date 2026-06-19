# TypeScript checks

## Contents
- `any` usage
- Unsafe type assertion
- Non-null assertion on unverified value
- Duplicate type definitions

---

## `any` usage

Added lines containing `: any` or `as any` without an explanatory comment.

Severity: 🟡

## Unsafe type assertion

`as SomeType` where the value comes from:
- `JSON.parse`
- `fetch` / `axios` response body
- External library without types
- DOM API

Suggest Zod, valibot, or a type guard instead.

Severity: 🟡

## Non-null assertion on unverified value

`value!` where `value` could plausibly be null/undefined from the visible
data flow in the patch.

Severity: 🟡

## Duplicate type definitions

The same shape defined twice in the diff.
Suggest extracting to a shared type file.

Severity: 🟢

## Issue format

```
**[TS] Short title**
File: `path/to/file.ts` (line N)
Why it matters: {the runtime risk}
Suggestion: {concrete fix}
```
