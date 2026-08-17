# Performance checks

## Contents
- Bundle size (URL Fetch: bundlephobia)
- List virtualization
- Memoization opportunity
- Image optimization

---

## Bundle size

When a new entry appears in `dependencies` (not `devDependencies`):

```
URL Fetch: https://bundlephobia.com/package/{package-name}@{version}
```

Thresholds:
- > 20 kB gzip for a utility → 🟡
- > 50 kB gzip for a UI library → 🟡

Report the gzip size and suggest a lighter alternative when one exists.

## List virtualization

`Array.map()` rendering without windowing, when the array comes from
an API that could return large datasets.

Suggest: `react-window`, `vue-virtual-scroller`, `@tanstack/virtual`

Severity: 🟡

## Memoization opportunity

Expensive computation (sort/filter/reduce on large arrays) in a render
function without memoization. Flag only when clearly visible in the patch.

Severity: 🟢

## Image optimization

Raw `<img src="...">` in a meta-framework project instead of the framework's
image component:

| Framework | Component |
|---|---|
| Next.js | `next/image` |
| Nuxt.js | `nuxt/image` |
| SvelteKit | `@sveltejs/enhanced-img` |

Severity: 🟡 (CLS risk + missed lazy loading)

## Issue format

```
**[PERF] Short title**
File: `path/to/file` (line N)
Why it matters: {user-visible impact}
Suggestion: {concrete alternative}
```
