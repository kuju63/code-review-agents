# Accessibility checks

## Contents
- Interactive element semantics
- Form label association
- Image alt text
- ARIA misuse
- Color contrast
- Focus management

---

## Interactive element semantics

`<div onClick>` or `<span onClick>` without `role`, `tabIndex`, and keyboard handler.
Prefer native `<button>` or `<a>`.

Severity: 🔴

## Form label association

`<input>` without `<label>` (via `for`/`id`, `aria-label`, or `aria-labelledby`).
Placeholder-only is not sufficient.

Severity: 🔴

## Image alt text

- `<img>` without `alt` → 🔴
- `<img alt="">` for decorative images is correct

## ARIA misuse

- `aria-hidden="true"` on a focusable element → 🔴
- `role="button"` on a `<button>` (redundant) → 🟢

## Color contrast

Flag only if the patch introduces inline color styles or CSS-in-JS color values.
Do not compute ratios — suggest checking with a contrast tool (WCAG AA = 4.5:1).

Severity: 🟡

## Focus management

- Modal/dialog opened without focus trap or focus return on close → 🟡
- `autoFocus` without accessible justification → 🟢

## Issue format

```
**[A11Y] Short title**
File: `path/to/file` (line N)
Why it matters: {who is affected and how}
Suggestion: {concrete fix}
Ref: https://www.w3.org/WAI/ARIA/apg/
```
