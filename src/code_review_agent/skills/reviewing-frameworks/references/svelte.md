# Svelte checks

## Contents
- Reactivity tracking (Svelte 4)
- Runes reactivity (Svelte 5)
- Runes migration consistency
- each block key
- onMount cleanup
- Store subscription leak
- {@html} XSS

---

## Reactivity tracking (Svelte 4)

`$:` statement references a variable that is mutated but not reassigned
(e.g. `array.push()`) — reactivity will not trigger.

Severity: 🔴

## Runes reactivity (Svelte 5)

Mutation of a `$state` object without reassignment where `$derived` depends on it.

Severity: 🔴

Ref: https://svelte.dev/docs/svelte/reactivity

## Runes migration consistency

Project uses Svelte 5 Runes (`$state`, `$derived`, `$effect`) elsewhere
but this PR introduces Svelte 4 syntax (`$:`, `export let`).

Severity: 🟡

Ref: https://svelte.dev/docs/svelte/svelte5-migration-guide

## each block key

`{#each items as item}` without `(item.id)` key in a mutable list.

Severity: 🔴

## onMount cleanup

`onMount` returning nothing when an event listener or timer was set up inside.

Severity: 🔴

## Store subscription leak

Manual `store.subscribe()` without storing and calling the unsubscriber
in `onDestroy`. Auto-subscription (`$store`) is safe — do not flag.

Severity: 🔴

## {@html} XSS

`{@html value}` with a value that is not a hardcoded string literal.
Check for DOMPurify or equivalent sanitization.

Severity: 🔴

## Context7 trigger examples

- Svelte 5 Runes: `$effect.pre`, `$props`, `$bindable`
- `svelte/transition` and `svelte/animate` API changes
- Svelte 5 snippet syntax (`{#snippet}`, `{@render}`)

## Issue format

```
**[SVELTE] Short title**
File: `path/to/file.svelte` (line N)
Why it matters: {one sentence}
Suggestion: {concrete fix}
Ref: {link if applicable}
```
