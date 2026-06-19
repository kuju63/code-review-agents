# Next.js checks

## Contents
- Server / Client Component boundary
- Data fetching location
- Cache / revalidation intent
- Environment variables
- next/image dimensions
- Middleware matcher

---

## Server / Client Component boundary

`'use client'` added to a component that:
- Has no hooks, no event handlers → could remain a Server Component → 🟡

Client Component importing a Server Component → 🔴

Ref: https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns

## Data fetching location

- `useEffect` fetch in a Client Component when Server Component fetch would suffice → 🟡
- API key / secret visible in a Client Component's fetch call → 🔴

## Cache / revalidation intent

`fetch()` in a Server Component without `cache` or `next.revalidate` when
the PR body implies caching intent.

Severity: 🟢

Ref: https://nextjs.org/docs/app/building-your-application/data-fetching/incremental-static-regeneration

## Environment variables

- `NEXT_PUBLIC_` on a variable used only server-side → 🟡 (unnecessary exposure)
- `NEXT_PUBLIC_` on a value that must be secret (DB URL, private key) → 🔴

## next/image dimensions

`<Image>` without `width`/`height` and without `fill` prop.
Causes runtime warning and CLS.

Severity: 🟡

Ref: https://nextjs.org/docs/app/api-reference/components/image

## Middleware matcher

New Middleware without a `matcher` config, or a matcher that accidentally
covers static assets or API routes it should not.

Severity: 🟡

Ref: https://nextjs.org/docs/app/building-your-application/routing/middleware

## Context7 trigger examples

- App Router APIs: `generateMetadata`, `generateStaticParams`
- Server Actions (`'use server'`)
- Partial Prerendering (`experimental_ppr`)
- `use cache` directive (Next.js 15+), `after()` API
- `unstable_cache`, `revalidateTag`, `revalidatePath`

## Issue format

```
**[NEXT.JS] Short title**
File: `path/to/file.tsx` (line N)
Why it matters: {one sentence}
Suggestion: {concrete fix}
Ref: {nextjs.org link if applicable}
```
