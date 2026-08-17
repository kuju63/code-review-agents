# Dependency audit checks

## Contents
- Justification
- Maintenance status (Context7)
- Duplication with existing packages
- License compatibility
- Bundle size (→ see performance.md)

---

## Justification

No reason given in `PR_BODY` for adding the dependency?
→ Add to "Questions for the author"

## Maintenance status

Use Context7 to check documentation health:

```
Context7:resolve-library-id("{library-name}", "maintenance status latest version")
→ Context7:query-docs(libraryId, "latest version changelog breaking changes")
```

Flag if: no docs on Context7, or no major update in > 2 years.

Severity: 🟡

## Duplication

Common pairs to flag:

| New package | Existing equivalent |
|---|---|
| `underscore` | `lodash` |
| `got` / `ky` | `axios` |
| `moment` | `date-fns` / `dayjs` |
| `classnames` | `clsx` |
| `uuid` | `nanoid` |

Severity: 🟡

## License

GPL, AGPL, or SSPL → flag for legal review.

Severity: 🔴

## Bundle size

→ See [performance.md](performance.md) check 1 for bundlephobia URL Fetch procedure.

## Issue format

```
**[DEPS] Short title**
Package: `{name}@{version}`
Why it matters: {one sentence}
Suggestion: {alternative or required action}
```
