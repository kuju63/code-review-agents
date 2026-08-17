# Angular checks

## Contents
- Observable subscription leak
- ChangeDetectionStrategy
- trackBy in ngFor
- DI scope mismatch
- Signals (Angular 17+)
- innerHTML XSS

---

## Observable subscription leak

`subscribe()` without any of:
- `async` pipe in template
- `takeUntilDestroyed()` (Angular 16+)
- `takeUntil(this.destroy$)` paired with `ngOnDestroy`
- explicit `unsubscribe()` stored and called in `ngOnDestroy`

Severity: 🔴 (memory leak, stale state)

## ChangeDetectionStrategy

New component without `ChangeDetectionStrategy.OnPush` in a project
that uses it elsewhere.

Severity: 🟡

Ref: https://angular.dev/best-practices/skipping-subtrees

## trackBy in ngFor

`*ngFor` / `@for` over a non-trivial array without `trackBy` / `track`.

Severity: 🟡

## DI scope mismatch

- `providedIn: 'root'` service holding per-component mutable state → 🔴
- Component-level service intended as a singleton → 🟡

## Signals (Angular 17+)

- `effect()` used for derived value computation → use `computed()` instead → 🟡
- Signal mutation inside `computed()` → 🔴

Ref: https://angular.dev/guide/signals

## innerHTML XSS

`[innerHTML]` binding with a value that is not a hardcoded string literal.
Check for `DomSanitizer.bypassSecurityTrustHtml` misuse.

Severity: 🔴

## Context7 trigger examples

- Angular 17+ control flow (`@if`, `@for`, `@defer`)
- `inject()` function API
- Functional guards / resolvers
- `linkedSignal`, `resource()`

## Issue format

```
**[ANGULAR] Short title**
File: `path/to/file.ts` (line N)
Why it matters: {one sentence}
Suggestion: {concrete fix}
Ref: {link if applicable}
```
