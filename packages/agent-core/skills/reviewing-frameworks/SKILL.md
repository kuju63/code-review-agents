---
name: reviewing-frameworks
description: Applies framework-specific review checks to a frontend PR — component design, hook/reactivity patterns, and framework-specific XSS vectors for React, Vue.js, Angular, and Svelte. Use when the diff touches component files, hooks, composables, directives, or stores. Detect the framework from DEPENDENCIES and file extensions, then load only the matching reference file. Use Context7 MCP when a framework API in the patch is version-specific or unfamiliar.
---

# Reviewing framework-specific concerns

Detect the framework from `DEPENDENCIES` and file extensions, then load
only the matching reference file.

## Reference files

| Framework | File                                           | Detect by                                                |
|-----------|------------------------------------------------|----------------------------------------------------------|
| React     | [references/react.md](references/react.md)     | `"react"` in dependencies, `.tsx` / `.jsx` files         |
| Vue.js    | [references/vue.md](references/vue.md)         | `"vue"` in dependencies, `.vue` files                    |
| Angular   | [references/angular.md](references/angular.md) | `"@angular/core"` in dependencies, `.component.ts` files |
| Svelte    | [references/svelte.md](references/svelte.md)   | `"svelte"` in dependencies, `.svelte` files              |

Multiple frameworks may be present in a monorepo — load all that match.

## Shared component design checks (all frameworks)

Apply before loading the framework-specific reference:

1. **Single responsibility** — component mixes data fetching + rendering + business logic → 🟡
2. **Naming mismatch** — component named `UserCard` performs side effects or routing → 🟢
3. **Props contract** — props lack type definitions or default values → 🟡

## Context7 usage

Load the framework-specific reference first. Then use Context7 only when
a specific API in the patch is unfamiliar or version-gated:

```
Context7:resolve-library-id("{Framework name}", "{specific API question}")
→ Context7:query-docs(libraryId, "{specific API question}")
```

Limit: at most 2 Context7 call pairs per review session.
