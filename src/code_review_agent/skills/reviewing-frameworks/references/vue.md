# Vue.js checks

## Contents
- Composition vs Options API consistency
- watch / watchEffect depth
- computed vs method misuse
- defineProps / defineEmits without types
- v-for key
- v-html XSS

---

## Composition vs Options API consistency

Project uses Composition API but PR introduces Options API (or vice versa).

Severity: 🟡

Ref: https://vuejs.org/guide/extras/composition-api-faq

## watch / watchEffect depth

`watch(..., { deep: true })` on a large reactive object without justification.
Suggest watching a specific computed property instead.

Severity: 🟡

## computed vs method misuse

- Computed property with a side effect (network call, DOM mutation) → 🔴
- Method called in template without arguments where a cached computed
  would be more appropriate → 🟢

## defineProps / defineEmits without types

In TypeScript projects, untyped props reduce IDE support and runtime safety.

Severity: 🟡

Ref: https://vuejs.org/guide/typescript/composition-api

## v-for key

- `v-for` without `:key` → 🔴
- `:key="index"` in a mutable list (items can be removed/reordered) → 🔴

## v-html XSS

`v-html` with a value that is not a hardcoded string literal.
Check for DOMPurify or equivalent sanitization.

Severity: 🔴

## Context7 trigger examples

- Vue 3 Vapor mode APIs
- `defineModel()`, `defineOptions()`
- Suspense, Teleport edge cases
- `provide` / `inject` typing patterns

## Issue format

```
**[VUE] Short title**
File: `path/to/file.vue` (line N)
Why it matters: {one sentence}
Suggestion: {concrete fix}
Ref: {link if applicable}
```
