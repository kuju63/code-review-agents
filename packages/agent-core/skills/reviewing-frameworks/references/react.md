# React checks

## Contents
- useEffect dependency array
- Missing cleanup
- Unstable key
- Unnecessary memoization
- Context over-provision
- dangerouslySetInnerHTML XSS

---

## useEffect dependency array

For every `useEffect` in the diff:

- Missing dependency referenced inside the effect → 🔴
- Stale closure (function defined outside, not memoized) → 🔴
- Object/array literal as dependency (new reference each render) → 🟡
- `// eslint-disable-line react-hooks/exhaustive-deps` without comment → 🟡

Ref: https://react.dev/learn/synchronizing-with-effects

## Missing cleanup

`useEffect` sets up event listener, `setInterval`, `setTimeout`, WebSocket,
or observable subscription — no cleanup return function.

Severity: 🔴 (memory leak / stale handler)

## Unstable key

- `key={index}` in a list where items can be reordered or removed → 🔴
- `key={Math.random()}` → 🔴

## Unnecessary memoization

`useMemo` / `useCallback` wrapping a primitive value or trivial operation.

Severity: 🟢

Ref: https://react.dev/reference/react/memo

## Context over-provision

New `Provider` wrapping a large subtree where only one leaf consumes it.
Suggest moving the provider closer to the consumer.

Severity: 🟢

## dangerouslySetInnerHTML XSS

`dangerouslySetInnerHTML` with a value that is not a hardcoded string literal.
Check for DOMPurify or equivalent sanitization.

Severity: 🔴

## Context7 trigger examples

- `use()`, `useOptimistic()`, `useDeferredValue()`, `useFormStatus()`
- React Server Components, Server Actions
- `startTransition`, `useTransition`

## Issue format

```
**[REACT] Short title**
File: `path/to/file.tsx` (line N)
Why it matters: {one sentence}
Suggestion: {concrete fix with code snippet}
Ref: {link if applicable}
```
