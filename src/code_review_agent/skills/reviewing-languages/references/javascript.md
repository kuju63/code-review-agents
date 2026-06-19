# JavaScript checks

## Contents
- Implicit type coercion
- `==` vs `===`
- `var` in new code
- Missing error handling in Promise chains
- Prototype pollution risk

---

## Implicit type coercion

Operations mixing string and number without explicit conversion
(e.g. `"5" + 3`, `parseInt` without radix).

Severity: 🟡

## `==` vs `===`

Loose equality `==` in a context where type coercion is not intended.

Severity: 🟡

## `var` in new code

`var` declarations in newly added code (prefer `const` / `let`).

Severity: 🟢

## Missing error handling in Promise chains

`.then()` without `.catch()`, or `async` function with `await` outside
a try/catch and no upstream error boundary.

Severity: 🟡

## Prototype pollution risk

`Object.assign(target, userInput)` or spread of untrusted input into
a plain object used as configuration or prototype source.

Severity: 🔴 if input is user-controlled, 🟡 otherwise

## Issue format

```
**[JS] Short title**
File: `path/to/file.js` (line N)
Why it matters: {the runtime risk}
Suggestion: {concrete fix}
```
