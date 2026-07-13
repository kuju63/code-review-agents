#!/usr/bin/env python3
"""Generate Seeded set from Gold set using mutation catalog.

Usage:
  python evaluation/tools/build_seeded_set.py \
    --gold evaluation/data/gold_pr_set.jsonl \
    --catalog evaluation/config/seeded_mutations.json \
    --output evaluation/data/seeded_set.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
from typing import Any

from dotenv import load_dotenv


def read_jsonl(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def detect_lang(path: str) -> str:
    if path.endswith(".svelte"):
        return "svelte"
    if path.endswith(".vue"):
        return "vue"
    if path.endswith(".tsx"):
        return "tsx"
    if path.endswith(".ts"):
        return "ts"
    if path.endswith(".jsx"):
        return "jsx"
    if path.endswith(".js"):
        return "js"
    if path.endswith(".html"):
        return "html"
    if path.endswith(".css"):
        return "css"
    if path.endswith(".scss"):
        return "scss"
    return "unknown"


_TEST_PATH_PATTERNS = (
    "/__tests__/",
    "/__test__/",
    ".test.js",
    ".test.ts",
    ".test.jsx",
    ".test.tsx",
    ".spec.js",
    ".spec.ts",
    ".spec.jsx",
    ".spec.tsx",
    "/test_",
    "_test.py",
    "/tests/",
)


def is_test_file(path: str) -> bool:
    return any(pat in path for pat in _TEST_PATH_PATTERNS)


def inject_patch(
    original_patch: str,
    line_snippet: str,
    context_lines: list[str] | None = None,
) -> tuple[str, int]:
    """Inject `line_snippet` into the hunk with the most added lines.

    Selects the densest hunk (select_target_hunk) rather than always the
    first, so the mutation lands in the block of substantive change
    rather than floating among unrelated import lines. Falls back to the
    legacy top-of-patch insertion when the patch has no hunk header at
    all (no candidate hunk to target).
    """
    patch_lines = original_patch.splitlines()
    if not patch_lines:
        return original_patch, 1

    prefix = [f"+{cl}" for cl in (context_lines or [])]

    hunks = split_hunks(original_patch)
    if not hunks:
        insert_idx = 1 if patch_lines[0].startswith("@@") else 0
        injected = (
            patch_lines[:insert_idx]
            + prefix
            + [f"+{line_snippet}"]
            + patch_lines[insert_idx:]
        )
        # Best-effort line extraction for a header-like line that starts
        # with "@@" but doesn't match the strict hunk header pattern (so
        # split_hunks() couldn't use it). Falls back to 1 when insert_idx
        # is 0 (no header-like line at all) or no number is found.
        base_line = 1
        if insert_idx == 1:
            m = re.search(r"\+(\d+)", patch_lines[0])
            base_line = int(m.group(1)) if m else 1
        return "\n".join(injected), base_line + len(context_lines or [])

    target_idx = select_target_hunk(hunks)
    target_hunk = hunks[target_idx]
    insertion_idx = find_insertion_point(target_hunk)

    base_line = parse_hunk_new_start(target_hunk[0])
    consumed = count_new_lines_before(target_hunk, insertion_idx)
    injected_line = base_line + consumed + len(context_lines or [])

    hunks[target_idx] = (
        target_hunk[: insertion_idx + 1]
        + prefix
        + [f"+{line_snippet}"]
        + target_hunk[insertion_idx + 1 :]
    )
    injected = [line for hunk in hunks for line in hunk]
    return "\n".join(injected), injected_line


def get_snippet_for_lang(rule: dict[str, Any], lang: str) -> str:
    """Look up the language-specific snippet for `rule`.

    `validate_catalog` is expected to reject any catalog where `languages`
    isn't fully covered by `language_snippets` before this is called, so
    the `line_snippet` fallback below is a defensive backstop rather than
    a normal code path.
    """
    lang_snippets = rule.get("language_snippets", {})
    return lang_snippets.get(lang) or rule["line_snippet"]


_VALID_RUNTIMES = {"browser", "node", "universal"}
_FORBIDDEN_GLOBAL_RE = re.compile(r"\b(window|document)\.")


def validate_catalog(rules: list[Any]) -> list[str]:
    """Validate the mutation catalog and return a list of error messages.

    Enforces R7 (every declared language has a snippet) and a static
    floor for R2 (runtime tagging present and valid, no bare
    `window.`/`document.` references that would be nonsensical outside a
    browser context). An empty return means the catalog is safe to use;
    callers should treat any non-empty result as fatal.

    `rules` is typed as `list[Any]` rather than `list[dict[str, Any]]`
    because this function is the first line of defense against a
    malformed catalog loaded straight from JSON: individual entries may
    not be dicts at all, which is checked explicitly below rather than
    assumed away by the type annotation.
    """
    errors: list[str] = []
    for rule in rules:
        if not isinstance(rule, dict):
            errors.append(
                f"rule entry must be an object, got {type(rule).__name__}: {rule!r}"
            )
            continue

        rule_id = rule.get("rule_id", "<unknown>")

        languages = rule.get("languages", [])
        if not isinstance(languages, list):
            errors.append(
                f"rule {rule_id!r}: languages must be a list, "
                f"got {type(languages).__name__}"
            )
            languages = []

        snippets = rule.get("language_snippets", {})
        if not isinstance(snippets, dict):
            errors.append(
                f"rule {rule_id!r}: language_snippets must be a dict, "
                f"got {type(snippets).__name__}"
            )
            snippets = {}

        non_string_langs = [lang for lang in languages if not isinstance(lang, str)]
        if non_string_langs:
            errors.append(
                f"rule {rule_id!r}: languages entries must be strings, "
                f"got {non_string_langs}"
            )
        string_langs = [lang for lang in languages if isinstance(lang, str)]

        missing = [lang for lang in string_langs if lang not in snippets]
        if missing:
            errors.append(f"rule {rule_id!r}: missing language_snippets for {missing}")

        runtime = rule.get("runtime")
        if runtime not in _VALID_RUNTIMES:
            errors.append(
                f"rule {rule_id!r}: runtime must be one of "
                f"{sorted(_VALID_RUNTIMES)}, got {runtime!r}"
            )

        required_tokens = rule.get("required_tokens")
        if not isinstance(required_tokens, list) or not required_tokens:
            errors.append(
                f"rule {rule_id!r}: required_tokens must be a non-empty list, "
                f"got {required_tokens!r}"
            )
            required_tokens = []

        compiled_tokens: list[re.Pattern[str]] = []
        for token in required_tokens:
            if not isinstance(token, str):
                errors.append(
                    f"rule {rule_id!r}: required_tokens entries must be "
                    f"strings, got {type(token).__name__}: {token!r}"
                )
                continue
            try:
                compiled_tokens.append(re.compile(token))
            except re.error as exc:
                errors.append(
                    f"rule {rule_id!r}: required_tokens entry {token!r} is "
                    f"not a valid regex: {exc}"
                )

        context_lines = rule.get("context_lines")
        if context_lines is not None and not isinstance(context_lines, list):
            errors.append(
                f"rule {rule_id!r}: context_lines must be a list, "
                f"got {type(context_lines).__name__}"
            )
            context_lines = []

        line_snippet = rule.get("line_snippet")
        if not isinstance(line_snippet, str):
            errors.append(
                f"rule {rule_id!r}: line_snippet must be a string, "
                f"got {type(line_snippet).__name__}"
            )
            line_snippet = None

        # Self-consistency (only meaningful once every required_tokens entry
        # is itself a valid compiled regex; otherwise the entries above
        # already report the root cause and this would just add noise).
        if len(compiled_tokens) == len(required_tokens) and compiled_tokens:
            if line_snippet is not None and not all(
                p.search(line_snippet) for p in compiled_tokens
            ):
                errors.append(
                    f"rule {rule_id!r}: line_snippet does not satisfy "
                    f"required_tokens: {line_snippet!r}"
                )
            for lang, snippet in snippets.items():
                if not isinstance(snippet, str):
                    continue  # already reported by the type check below
                if not all(p.search(snippet) for p in compiled_tokens):
                    errors.append(
                        f"rule {rule_id!r}: language_snippets[{lang!r}] does "
                        f"not satisfy required_tokens: {snippet!r}"
                    )

        texts = list(snippets.values()) + list(context_lines or [])
        if line_snippet is not None:
            texts.append(line_snippet)
        for text in texts:
            if not isinstance(text, str):
                errors.append(
                    f"rule {rule_id!r}: snippet/context_line entries must be "
                    f"strings, got {type(text).__name__}: {text!r}"
                )
                continue
            if _FORBIDDEN_GLOBAL_RE.search(text):
                errors.append(
                    f"rule {rule_id!r}: snippet references a browser global "
                    f"(window./document.): {text!r}"
                )
    return errors


_HUNK_HEADER_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def split_hunks(patch: str) -> list[list[str]]:
    """Split a unified diff patch string into per-hunk line groups.

    Each returned group starts with its `@@ ... @@` header line. Lines
    before the first header (if any) are discarded; there is no sensible
    hunk to attach them to. Returns an empty list if the patch has no
    hunk header at all.
    """
    hunks: list[list[str]] = []
    for line in patch.splitlines():
        if _HUNK_HEADER_RE.match(line):
            hunks.append([line])
        elif hunks:
            hunks[-1].append(line)
    return hunks


def select_target_hunk(hunks: list[list[str]]) -> int:
    """Return the index of the hunk with the most added (`+`) lines.

    Ties resolve to the earliest hunk, matching the intuition that the
    first substantial change block is the more natural injection target.
    """
    added_counts = [
        sum(1 for line in hunk[1:] if line.startswith("+")) for hunk in hunks
    ]
    return added_counts.index(max(added_counts))


def parse_hunk_new_start(header_line: str) -> int:
    """Extract the new-file start line `c` from `@@ -a,b +c,d @@`.

    Falls back to 1 on a malformed header; this should not occur for real
    gold PR data but keeps the function total.
    """
    m = _HUNK_HEADER_RE.match(header_line)
    return int(m.group(1)) if m else 1


def count_new_lines_before(hunk_lines: list[str], insertion_idx: int) -> int:
    """Count new-file lines consumed between the hunk header and insertion_idx.

    Context (` `) and added (`+`) lines advance the new file's line
    counter; removed (`-`) lines do not, since they are absent from the
    new file.
    """
    return sum(
        1
        for line in hunk_lines[1 : insertion_idx + 1]
        if line.startswith(" ") or line.startswith("+")
    )


_STATEMENT_END_RE = re.compile(r"[;{]\s*$")
_IMPORT_LIKE_RE = re.compile(
    r"^\+\s*(import\s|export\s+.*\bfrom\b|const\s+\w+\s*=\s*require\()"
)


def find_insertion_point(hunk_lines: list[str]) -> int:
    """Pick the index in `hunk_lines` (header at index 0) to insert after.

    Preference order:
      1. The last non-import added line ending in `;` or `{` -- a safe
         statement/block-start boundary in the same scope.
      2. The last non-import added line, regardless of pattern, if no
         terminator-matching line exists.
      3. The last added line overall (even if import-like) when every
         added line looks like an import -- a known Phase 1 limitation
         (see docs/eval-seeded-mutation-injection-design.md 3.1.3).
      4. The header itself (index 0) when the hunk has no added lines.

    Closing braces (`}`) are deliberately excluded from the terminator
    pattern: inserting right after one risks landing outside the scope
    that brace closes.
    """
    added_idxs = [i for i, line in enumerate(hunk_lines) if line.startswith("+")]
    if not added_idxs:
        return 0

    non_import_idxs = [
        i for i in added_idxs if not _IMPORT_LIKE_RE.match(hunk_lines[i])
    ]
    if not non_import_idxs:
        return added_idxs[-1]

    terminated_idxs = [
        i for i in non_import_idxs if _STATEMENT_END_RE.search(hunk_lines[i])
    ]
    if terminated_idxs:
        return terminated_idxs[-1]

    return non_import_idxs[-1]


def candidate_files(gold_item: dict[str, Any]) -> list[dict[str, Any]]:
    """Pick the file_changes eligible as a mutation target.

    Prefers production files (non-test, with a non-empty patch) over test
    files so agents see realistic vulnerabilities; falls back to all
    file_changes when no production file qualifies.
    """
    file_changes = gold_item.get("file_changes", [])
    prod_candidates = [
        fc
        for fc in file_changes
        if fc.get("patch") and not is_test_file(fc.get("path", ""))
    ]
    return prod_candidates if prod_candidates else file_changes


def enumerate_combo_pool(
    gold_item: dict[str, Any], rules: list[dict[str, Any]]
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Enumerate every distinct (file_change, rule) pair valid for this item.

    A pair is valid when the rule's `languages` list contains the file's
    detected language. Pool size is NOT files x rules -- it is the sum,
    over candidate files, of the count of rules whose `languages` include
    that file's detected language, since each file may have a different
    detected language and thus a different set of matching rules.
    """
    pool: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for fc in candidate_files(gold_item):
        lang = detect_lang(fc.get("path", ""))
        for rule in rules:
            if lang in rule.get("languages", []):
                pool.append((fc, rule))
    return pool


def render_seeded_item(
    gold_item: dict[str, Any],
    file_change: dict[str, Any],
    rule: dict[str, Any],
) -> dict[str, Any]:
    """Build one Seeded item from an already-chosen (file_change, rule) combo."""
    path = file_change.get("path", "")
    patch = file_change.get("patch") or ""
    lang = detect_lang(path)
    snippet = get_snippet_for_lang(rule, lang)
    context_lines = rule.get("context_lines")
    seeded_patch, seeded_line = inject_patch(patch, snippet, context_lines)

    file_changes = gold_item.get("file_changes", [])
    seeded_changes = [
        {"path": path, "patch": seeded_patch} if fc is file_change else fc
        for fc in file_changes
    ]

    return {
        "id": f"seeded::{gold_item['id']}::{rule['rule_id']}::{path}",
        "base_source": gold_item["id"],
        "repository": gold_item["repository"],
        "pr_number": gold_item["pr_number"],
        "file_changes": seeded_changes,
        "must_find": [
            {
                "rule_id": rule["rule_id"],
                "category": rule["category"],
                "severity": rule["severity"],
                "path": path,
                "line": seeded_line,
                "summary": rule["summary"],
            }
        ],
    }


def build_seeded_items(
    gold_item: dict[str, Any],
    rules: list[dict[str, Any]],
    rnd: random.Random,
    multiplier: int,
) -> tuple[list[dict[str, Any]], str | None]:
    """Build up to `multiplier` distinct Seeded items for one Gold item.

    Samples (file, rule) combos WITHOUT replacement: enumerates the full
    valid combo pool, shuffles it deterministically with `rnd`, then takes
    the first min(multiplier, len(pool)) entries. Shuffle-then-slice is
    used instead of retry-on-duplicate because retrying is unbounded/
    wasteful once the pool is nearly exhausted.

    Returns ([], None) when the pool is empty (no candidate file's
    language matches any rule), matching prior silent-skip behavior.
    Returns a non-None warning when `multiplier` exceeds the pool size,
    in which case the requested count is clamped to the pool size.
    """
    pool = enumerate_combo_pool(gold_item, rules)
    if not pool:
        return [], None

    rnd.shuffle(pool)
    requested = max(multiplier, 1)
    take = min(requested, len(pool))

    warning = None
    if requested > len(pool):
        warning = (
            f"[SEEDED-WARN] gold_id={gold_item['id']!r}: requested "
            f"multiplier={requested} exceeds available (file, rule) "
            f"combinations={len(pool)}; clamping to {take} seeded item(s)."
        )

    items = [render_seeded_item(gold_item, fc, rule) for fc, rule in pool[:take]]
    return items, warning


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Build Seeded set from Gold set")
    parser.add_argument("--gold", required=True, help="Path to Gold JSONL")
    parser.add_argument(
        "--catalog", required=True, help="Path to mutation catalog JSON"
    )
    parser.add_argument("--output", required=True, help="Path to output Seeded JSONL")
    parser.add_argument(
        "--multiplier", type=int, default=1, help="Seeded items per Gold item"
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    rnd = random.Random(args.seed)
    gold_items = read_jsonl(args.gold)
    with open(args.catalog, encoding="utf-8") as f:
        catalog = json.load(f)
    if not isinstance(catalog, dict):
        print(
            f"[SEEDED-ERROR] catalog root must be an object, "
            f"got {type(catalog).__name__}",
            file=sys.stderr,
        )
        return 1

    rules = catalog.get("rules", [])
    if not isinstance(rules, list):
        print(
            f"[SEEDED-ERROR] catalog 'rules' must be a list, "
            f"got {type(rules).__name__}",
            file=sys.stderr,
        )
        return 1

    catalog_errors = validate_catalog(rules)
    if catalog_errors:
        for err in catalog_errors:
            print(f"[SEEDED-ERROR] {err}", file=sys.stderr)
        return 1

    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    count = 0
    with open(args.output, "w", encoding="utf-8") as out:
        for item in gold_items:
            items, warning = build_seeded_items(item, rules, rnd, args.multiplier)
            if warning:
                print(warning, file=sys.stderr)
            for seeded in items:
                out.write(json.dumps(seeded, ensure_ascii=False) + "\n")
                count += 1

    print(f"Done. Seeded items: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
