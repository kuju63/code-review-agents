---
name: reviewing-universal
description: Applies framework-agnostic review checks to any frontend PR — logic correctness, async error handling, edge cases, race conditions, accessibility, security (XSS, secrets, env vars), dependency audit, performance, and test quality. Use on every PR regardless of framework. Load specific reference files only for the check categories relevant to the diff.
---

# Reviewing universal concerns

These checks apply to every frontend PR regardless of framework or language.
Load only the reference files needed for the current diff.

## Reference files

| Category            | File                                                       | Load when                              |
|---------------------|------------------------------------------------------------|----------------------------------------|
| Logic & correctness | [references/correctness.md](references/correctness.md)     | Any non-trivial logic change           |
| Accessibility       | [references/accessibility.md](references/accessibility.md) | Any HTML/JSX/template change           |
| Security            | [references/security.md](references/security.md)           | **Every PR — mandatory**               |
| Dependency audit    | [references/dependencies.md](references/dependencies.md)   | package.json has new entries           |
| Performance         | [references/performance.md](references/performance.md)     | New dependency or list/image rendering |
| Test quality        | [references/test-quality.md](references/test-quality.md)   | Test files in diff                     |

## Quick triage

Before loading references, scan the diff for these always-🔴 patterns:

- `dangerouslySetInnerHTML` / `v-html` / `{@html}` / `[innerHTML]` with non-literal value
- Hardcoded token/key strings (`sk-`, `Bearer `, `api_key`, hex >32 chars)
- `NEXT_PUBLIC_` / `VITE_` / `NUXT_PUBLIC_` on a value that must be server-only

If any are found, flag immediately before loading other references.
