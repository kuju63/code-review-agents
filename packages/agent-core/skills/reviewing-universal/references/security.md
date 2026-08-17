# Security checks

**This reference is mandatory on every PR.**

## Contents
- XSS via raw HTML injection  ← always 🔴
- Hardcoded secrets           ← always 🔴
- Environment variable misuse ← always 🔴
- Target blank without rel
- Client-side auth bypass
- CSRF surface

---

## XSS via raw HTML injection  🔴

Patterns: `dangerouslySetInnerHTML`, `v-html`, `{@html}`, `[innerHTML]`
with a value that is not a hardcoded string literal.

Check whether DOMPurify or equivalent sanitization is applied.

## Hardcoded secrets  🔴

Scan added lines for: `sk-`, `Bearer `, `api_key`, `password =`,
hex strings >32 chars, base64 blobs in config files.

## Environment variable misuse  🔴

`NEXT_PUBLIC_*`, `VITE_*`, `NUXT_PUBLIC_*` used for DB URLs, private keys,
or OAuth secrets that must never reach the client bundle.

## Target blank without rel

`<a target="_blank">` without `rel="noopener noreferrer"`.

Severity: 🟡

## Client-side auth bypass

Route guard changes that allow navigation to protected routes without
server-side enforcement.

Severity: 🔴 if bypass is clear, add to "Questions for the author" if ambiguous

## CSRF surface

New form submissions or mutation endpoints without CSRF token or SameSite strategy.
Flag only if the PR explicitly handles auth or forms.

Severity: 🟡

## Issue format

```
**[SECURITY] Short title**
File: `path/to/file` (line N)
Why it matters: {the concrete attack vector}
Suggestion: {concrete fix}
Ref: {CVE or OWASP link if applicable}
```
