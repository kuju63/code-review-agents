# SvelteKit checks

## Contents
- load function placement
- Environment variable module
- Form action validation
- Page options conflict
- Error boundary presence

---

## load function placement

Data requiring auth or DB access placed in `+page.ts` (universal load —
runs on both server and client) instead of `+page.server.ts`.

Severity: 🔴

Ref: https://kit.svelte.dev/docs/load

## Environment variable module

`$env/static/private` imported in a file that could run on the client
(`+page.ts`, `+layout.ts`, a component file).
SvelteKit errors at build time, but flag early.

Severity: 🔴

Ref: https://kit.svelte.dev/docs/modules#$env-static-private

## Form action validation

New `+page.server.ts` with `actions` export but no input validation
(no Zod, Superforms, or manual checks).

Severity: 🟡

Ref: https://kit.svelte.dev/docs/form-actions

## Page options conflict

`export const prerender = true` on a page that also exports `actions`.
This causes a build error.

Severity: 🔴

Ref: https://kit.svelte.dev/docs/page-options

## Error boundary presence

New routes without a `+error.svelte` at an appropriate layout level.

Severity: 🟢

## Context7 trigger examples

- SvelteKit 2 migration changes
- `load` event type changes
- `handle` hook in `hooks.server.ts`
- Adapter-specific APIs (`@sveltejs/adapter-cloudflare`, etc.)

## Issue format

```
**[SVELTEKIT] Short title**
File: `path/to/+page.server.ts` (line N)
Why it matters: {one sentence}
Suggestion: {concrete fix}
Ref: {kit.svelte.dev link if applicable}
```
