# Nuxt.js checks

## Contents
- useFetch vs $fetch
- runtimeConfig vs appConfig
- Server-only composable on client
- useState hydration mismatch
- Nitro route security

---

## useFetch vs $fetch

`$fetch` used directly in component setup — causes double fetch in SSR
(server fetch + client re-fetch).

Use `useFetch` or `useAsyncData(() => $fetch(...))` instead.

Severity: 🟡

Ref: https://nuxt.com/docs/getting-started/data-fetching

## runtimeConfig vs appConfig

| Correct use | Wrong use |
|---|---|
| `runtimeConfig` — server secrets, private keys | Secrets in `appConfig` → 🔴 |
| `runtimeConfig.public.*` — public runtime config | Private values in `runtimeConfig.public.*` → 🔴 |
| `appConfig` — public build-time config | — |

## Server-only composable on client

Composable from `server/` directory called in a component that renders
on the client.

Severity: 🔴

## useState hydration mismatch

`useState` initialized with a non-serializable value (function, class instance,
`Date` object) that differs between server and client.

Severity: 🔴

## Nitro route security

New files under `server/api/` or `server/routes/` without visible input
validation or auth check.

Severity: 🟡 — add to "Questions for the author" if intent is unclear

## Context7 trigger examples

- Nuxt 4 migration patterns
- `useRequestHeaders`, `callWithNuxt`
- `defineNuxtPlugin`, `defineNuxtRouteMiddleware`
- Edge runtime composables

## Issue format

```
**[NUXT] Short title**
File: `path/to/file.vue` (line N)
Why it matters: {one sentence}
Suggestion: {concrete fix}
Ref: {nuxt.com link if applicable}
```
