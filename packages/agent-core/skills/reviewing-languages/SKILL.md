---
name: reviewing-languages
description: Applies language-specific review checks to a frontend PR — TypeScript type safety (any, unsafe assertions, non-null, duplicate types) and JavaScript-specific pitfalls (implicit coercion, prototype pollution, missing strict mode). Use when the diff contains .ts, .tsx, .vue with lang="ts", .svelte with lang="ts" for TypeScript; or .js, .mjs, .cjs, .jsx files for JavaScript. Load only the reference file matching the language detected from DEPENDENCIES and file extensions.
---

# Reviewing language-specific concerns

Load only the reference file for the detected language.

## Reference files

| Language   | File                                                 | Detect by                                                            |
|------------|------------------------------------------------------|----------------------------------------------------------------------|
| TypeScript | [references/typescript.md](references/typescript.md) | `.ts` / `.tsx` extensions, or `"typescript"` in devDependencies      |
| JavaScript | [references/javascript.md](references/javascript.md) | `.js` / `.jsx` / `.mjs` extensions, no TypeScript in devDependencies |

Both may apply when a project mixes TS and JS files.
