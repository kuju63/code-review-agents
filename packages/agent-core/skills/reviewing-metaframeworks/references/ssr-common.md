# SSR / hydration checks (all meta-frameworks)

## Contents
- Hydration mismatch
- SEO metadata on new routes
- Sensitive data in SSR payload
- Error boundaries
- Web Vitals regressions

---

## Hydration mismatch  🔴

Non-deterministic values in render output without an SSR guard:

| Pattern | Safe alternative |
|---|---|
| `Math.random()` in markup | Move inside `useEffect` / `onMount` / `$effect` |
| `Date.now()` / `new Date()` for display | Format server-side or guard with `isClient` |
| `window.*` / `navigator.*` at module level | Gate with `typeof window !== 'undefined'` |
| `document.*` outside lifecycle hook | Move inside `useEffect` / `onMount` / `$effect` |
| `localStorage.*` in render | Gate with client check |

## SEO metadata on new routes

Flag only if repo summary indicates an SEO-sensitive product
(e-commerce, marketing site, blog).

Check for: `<title>`, `<meta name="description">`, OGP tags, or framework
metadata API (`generateMetadata`, `useHead`, `<svelte:head>`).

Severity: 🟡

## Sensitive data in SSR payload

Server-fetched data passed to the client containing fields beyond what the
UI requires (internal IDs, tokens, PII not shown in the view).

Flag as question for the author if intent is unclear.

Severity: 🟡

## Error boundaries

New pages or layouts without an error page at the appropriate route level.

Severity: 🟢

## Web Vitals regressions

- Images without dimensions or `fill` → CLS risk → 🟡
- Synchronous blocking scripts in `<head>` → LCP risk → 🟡
- Non-deferred third-party scripts → INP risk → 🟡

Ref: https://web.dev/articles/vitals
