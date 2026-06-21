---
name: reviewing-metaframeworks
description: Applies meta-framework-specific and SSR/hydration review checks to a frontend PR — Server/Client component boundaries, data fetching placement, environment variable exposure, routing configuration, and hydration mismatches for Next.js, Nuxt.js, and SvelteKit. Use when DEPENDENCIES includes "next", "nuxt", or "@sveltejs/kit", or when the diff touches pages, layouts, server routes, middleware, or framework config files. Load the SSR common reference first, then load only the reference file matching the detected meta-framework.
---

# Reviewing meta-framework concerns

Load `references/ssr-common.md` first (applies to all meta-frameworks),
then load the reference file matching the detected meta-framework.

## Reference files

| Scope                 | File                                                 | Load when                         |
|-----------------------|------------------------------------------------------|-----------------------------------|
| SSR / hydration (all) | [references/ssr-common.md](references/ssr-common.md) | Any meta-framework detected       |
| Next.js               | [references/nextjs.md](references/nextjs.md)         | `"next"` in dependencies          |
| Nuxt.js               | [references/nuxtjs.md](references/nuxtjs.md)         | `"nuxt"` in dependencies          |
| SvelteKit             | [references/sveltekit.md](references/sveltekit.md)   | `"@sveltejs/kit"` in dependencies |

## Quick triage (before loading references)

Always-🔴 patterns regardless of meta-framework:

- Non-deterministic value in render output without SSR guard:
  `Math.random()`, `Date.now()`, `new Date()`, `window.*`, `document.*`
  used outside `useEffect` / `onMount` / `$effect`
- Server-only secret reachable from the client bundle

## Context7 usage

Use after loading the framework-specific reference, when a version-specific
API appears in the patch:

```
Context7:resolve-library-id("{Framework name}", "{specific API question}")
→ Context7:query-docs(libraryId, "{specific API question}")
```

Limit: at most 2 Context7 call pairs per review session.
