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
import asyncio
import json
import logging
import os
import random
import re
import sys
from typing import Any, Callable, cast

from dotenv import load_dotenv
from pydantic import BaseModel, field_validator
from strands.models.openai import OpenAIModel
from strands.types.content import Messages

logger = logging.getLogger(__name__)


class MutatedPatchOutput(BaseModel):
    """Structured output requested from the Seeded mutation generation LLM.

    See design doc 3.2.2. `injected_line` is retained only as a record of
    the LLM's own reasoning (like `reachability_rationale`); the
    authoritative line number used for `must_find` is recomputed
    deterministically via `recompute_injected_line()` instead of trusting
    this self-reported value (see the "injected_line に関する注" in the
    design doc for why).

    Attributes:
        mutated_patch: Full unified diff after the vulnerability pattern
            has been injected.
        injected_line: 1-based new-file line number the LLM claims the
            injected code lives on. Record-only; not used for `must_find`.
        reachability_rationale: Brief, non-blank explanation of why the
            LLM judged the injection point reachable.
    """

    mutated_patch: str
    injected_line: int
    reachability_rationale: str

    @field_validator("reachability_rationale")
    @classmethod
    def _rationale_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("reachability_rationale must not be blank")
        return v


MutationGenerator = Callable[[str, dict[str, Any], str], MutatedPatchOutput | None]

_MUTATION_GEN_SYSTEM_PROMPT = """\
You are editing an existing unified diff patch by inserting new lines \
into it -- you are NOT writing a new snippet from scratch.

=== THE #1 RULE (read this before anything else) ===
`mutated_patch` MUST be the ENTIRE original patch given to you, \
reproduced character-for-character -- every hunk, every hunk header, \
every context/added/removed line -- with your new lines inserted as \
additional "+" lines in exactly one place. Copy every hunk through \
unchanged, including hunks you are not injecting into. Do NOT return \
only the injected snippet, only the changed hunk, or any subset of the \
patch. A correct answer is always at least as long as the original \
patch. If you find yourself about to output just one or two bare \
statements with no "@@ ... @@" header above them, that is wrong -- go \
back and include the full original patch around them.

Example (generic, illustrates the required transformation):

Original patch given to you:
@@ -1,1 +1,2 @@
 context1
+addedByPr

Correct mutated_patch:
@@ -1,1 +1,3 @@
 context1
+addedByPr
+injectedCall(userInput);

Note what happened: the hunk header came first and its line count was \
updated (1,2 -> 1,3); the pre-existing context line " context1" and the \
pre-existing added line "+addedByPr" were both copied through unchanged \
and in order; exactly one new "+" line was appended. Nothing was \
omitted, reordered, or rewritten. Do not reuse this example's literal \
content ("context1", "injectedCall") in your real answer -- it is \
illustrative only.

=== Requirements for the injected code itself ===
(a) Wire the injected code into the existing execution flow shown in the \
patch -- do not add an isolated/unreachable statement.
(b) Use the exact API/construct shown in the reference pattern given to \
you (e.g. the literal function name) -- do not substitute a \
semantically-equivalent alternative; automated checks look for the \
exact token.
(c) Use APIs that are valid for the target language and runtime given \
below (e.g. do not use browser-only globals such as window./document. \
in Node-only code).
(d) Match the surrounding code's variable names, scope, and style.
(e) Insert ALL of your new lines as ONE contiguous block of "+" lines, \
all within a single hunk. Do not split the injection across two hunks \
and do not interleave unchanged lines between two separate injected \
chunks.

=== Requirements for the diff format itself ===
(f) Return `mutated_patch` starting directly with a hunk header line \
("@@ -old_start,old_count +new_start,new_count @@") -- no markdown code \
fences, no explanation, no "diff --git"/"index"/"---"/"+++" preamble \
before it. Blank lines before the first header are fine.
(g) Only insert new lines starting with "+"; do not modify, remove, or \
reorder any existing line, and do not change any line that does not \
start with "+", " ", or "-". Hunk headers ("@@ ... @@") may be rewritten \
to reflect the new line count they introduce.

Return the full mutated patch (per the #1 rule above), the 1-based \
new-file line number where the injected code lives, and a brief \
rationale for why that location is reachable.
"""


def build_generation_prompt(patch: str, rule: dict[str, Any], lang: str) -> str:
    """Build the user prompt for one (file, rule) mutation generation call.

    Args:
        patch: Original unified diff for the target file_change.
        rule: Mutation catalog rule (must have `rule_id`, `summary`,
            `runtime`).
        lang: Target file's detected language, used to pick the
            reference snippet via `get_snippet_for_lang`.

    Returns:
        The full user prompt string to send to the generation LLM.
    """
    return (
        f"Target language: {lang}\n"
        f"Target runtime: {rule.get('runtime', 'universal')}\n"
        f"Vulnerability/bug pattern (rule_id={rule.get('rule_id')!r}): "
        f"{rule.get('summary', '')}\n"
        f"Example of the pattern (for reference, do not copy verbatim -- "
        f"adapt it to the surrounding code): {get_snippet_for_lang(rule, lang)!r}\n\n"
        f"Original patch (reproduce this ENTIRE patch verbatim in your "
        f"mutated_patch output, with your new lines inserted -- see the "
        f"#1 rule above):\n{patch}"
    )


def make_llm_mutation_generator(
    model_id: str, llm_base_url: str | None = None
) -> MutationGenerator:
    """Build a mutation generator backed by an OpenAI-compatible LLM.

    Mirrors the model-selection pattern used elsewhere in this repo
    (``base_reviewer.py`` / ``score_evaluation.py::make_llm_semantic_judge``):
    a custom ``llm_base_url`` gets a fixed low temperature (0.1) to
    reduce output variance; this does not guarantee reproducibility,
    since most models remain stochastic at any nonzero temperature
    (design doc 9.2 observed non-deterministic results across repeated
    calls even at this setting). The default endpoint is used as-is
    otherwise.

    Calls ``Model.structured_output()`` directly instead of going through
    ``Agent(...)(prompt, structured_output_model=...)``. The Agent-level
    path registers a synthetic tool and relies on the model invoking it
    (``tool_choice=auto`` on the first call, forced only on a retry after
    ``end_turn`` -- see strands-agents/harness-sdk#3336, open/unresolved
    as of this writing): a self-hosted OpenAI-compatible model can answer
    with the correct JSON as freeform text on both attempts without ever
    emitting a `tool_calls` entry, which raises `StructuredOutputException`
    on every call. `Model.structured_output()` sidesteps tool-calling
    entirely via the OpenAI-compatible `response_format` (JSON-schema
    constrained decoding), which this repo's local Ollama setup honors
    reliably. This is not the deprecated `Agent.structured_output()`
    convenience wrapper (which internally calls the same `Model` method) --
    the `Model.structured_output()` method itself carries no deprecation
    notice.

    Args:
        model_id: OpenAI-compatible model id to use for generation.
        llm_base_url: Optional OpenAI-compatible base URL. When set, the
            model is pinned to a low, fixed temperature (0.1) to reduce
            output variance -- not a reproducibility guarantee.

    Returns:
        A `MutationGenerator` callable: given `(patch, rule, lang)`, it
        returns a `MutatedPatchOutput` on success, or `None` (fail
        closed, no retry) when the LLM call raises or returns no
        structured output.
    """
    if llm_base_url:
        model = OpenAIModel(
            model_id=model_id,
            client_args={"base_url": llm_base_url},
            params={"temperature": 0.1},
        )
    else:
        model = OpenAIModel(model_id=model_id)

    def generate(
        patch: str, rule: dict[str, Any], lang: str
    ) -> MutatedPatchOutput | None:
        prompt = build_generation_prompt(patch, rule, lang)
        messages: Messages = [{"role": "user", "content": [{"text": prompt}]}]

        async def invoke() -> MutatedPatchOutput | None:
            last_event: dict[str, Any] | None = None
            async for event in model.structured_output(
                MutatedPatchOutput, messages, system_prompt=_MUTATION_GEN_SYSTEM_PROMPT
            ):
                last_event = event
            if last_event is None:
                return None
            return cast(MutatedPatchOutput, last_event["output"])

        try:
            return asyncio.run(invoke())
        except Exception as exc:
            # This single call failed closed; it does not retry itself.
            # The caller (render_seeded_item_with_generation, design doc
            # 9.4) may call this function again up to max_attempts times,
            # so this warning fires once per failed attempt, not once per
            # combo -- expect it to repeat under --llm-max-attempts > 1.
            #
            # The exception type is named in the summary (not just via
            # exc_info's traceback) so a structural failure -- e.g.
            # RuntimeError: asyncio.run() cannot be called from a running
            # event loop, if this were ever invoked from an async context
            # -- is distinguishable at a glance from ordinary model/network
            # flakiness, which would otherwise silently exhaust every
            # retry attempt with an identical-looking log line.
            logger.warning(
                "mutation generation call failed on this attempt (%s)",
                type(exc).__name__,
                exc_info=True,
            )
            return None

    return generate


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

    Returns:
        A ``(patched_text, injected_line)`` tuple: the patch text with
        ``line_snippet`` inserted, and the new-file line number it landed
        on. When ``original_patch`` is empty, returns it unchanged with
        ``injected_line`` set to ``1`` and no ``line_snippet`` inserted.
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

    Returns:
        The language-specific snippet for ``lang`` if present in
        ``rule["language_snippets"]``, otherwise ``rule["line_snippet"]``.
    """
    lang_snippets = rule.get("language_snippets", {})
    return lang_snippets.get(lang) or rule["line_snippet"]


_VALID_RUNTIMES = {"browser", "node", "universal"}
_FORBIDDEN_GLOBAL_RE = re.compile(r"\b(window|document)\.")

# Design doc §7.3/7.4.3 (Issue #131): a `required_tokens` entry requiring
# `await` implicitly requires the enclosing function to be declared
# `async`, but injection is pure addition (V2) -- no signature rewrite is
# permitted. A snippet that requires `await` must therefore declare its
# own `async` scope (e.g. an async IIFE) rather than depend on the
# enclosing code being async.
_SCOPE_DEPENDENT_TOKEN_RE = re.compile(r"\bawait\b")
# A bare `\basync\b` search would be satisfied by "async" appearing in a
# comment or string literal (e.g. "// not async"), letting a
# non-self-contained snippet slip through this build-time check only to
# surface later as a high deterministic_fallback rate. Instead require
# one of the actual JS/TS async declaration forms: `async function`,
# `async (...)`  / `async name(...)` (arrow/method), or `async name =>`.
# `[ \t]*` (not `\s*`) keeps the identifier/call forms from matching
# across a newline into unrelated code later in the same snippet.
# Same known limitation as design doc 7.9's whitespace-normalization
# case: this is a lexical match, not a parser, so a declaration-shaped
# string literal (e.g. `const x = "async function() {}"`) would still
# false-positive as a real async scope. Accepted for the same reason --
# the catalog has no `await`/`async` rules today, and a real fix needs
# actual JS/TS parsing.
_ASYNC_SCOPE_RE = re.compile(
    r"\basync\b[ \t]*(?:function\b|\(|[A-Za-z_$][\w$]*[ \t]*(?:\(|=>))"
)
# Matches a backslash-escape sequence (`\b`, `\s`, `\.`, etc.) in a regex
# pattern's own source text, so it can be blanked out before running
# _SCOPE_DEPENDENT_TOKEN_RE against that source: without this, a pattern
# like r"\bawait\b" contains the literal character run "bawaitb" (the
# escape letters sit directly against "await" with no real word boundary
# between them), which would make a naive \bawait\b search against the
# raw source fail even for the canonical, unambiguous case.
_REGEX_ESCAPE_SEQUENCE_RE = re.compile(r"\\.")


def _pattern_references_keyword(pattern_source: str, keyword_re: re.Pattern) -> bool:
    """Does `pattern_source` reference `keyword_re` as a literal,
    whole-word token -- not merely as a substring of a longer identifier
    (e.g. "awaited" contains "await" as a substring but isn't the
    `await` keyword)?

    Backslash-escape sequences are blanked out first (see
    `_REGEX_ESCAPE_SEQUENCE_RE`) so they can't accidentally supply a fake
    "adjacent letter" that breaks the word-boundary check on either side
    of the keyword, in either direction (false negative on `\bawait\b`
    itself, or false positive on `\bawaited\b`).

    Args:
        pattern_source: A regex's own source text (e.g. `r"\bawait\b"`),
            not text to be matched by that regex.
        keyword_re: A compiled regex identifying the keyword to look for,
            expected to itself use `\b` word boundaries.

    Returns:
        True if `pattern_source` references the keyword as a whole word.
    """
    cleaned = _REGEX_ESCAPE_SEQUENCE_RE.sub(" ", pattern_source)
    return bool(keyword_re.search(cleaned))


def validate_catalog(rules: list[Any]) -> list[str]:
    """Validate the mutation catalog and return a list of error messages.

    Enforces R7 (every declared language has a snippet) and a static
    floor for R2 (runtime tagging present and valid, no bare
    `window.`/`document.` references that would be nonsensical outside a
    browser context).

    `rules` is typed as `list[Any]` rather than `list[dict[str, Any]]`
    because this function is the first line of defense against a
    malformed catalog loaded straight from JSON: individual entries may
    not be dicts at all, which is checked explicitly below rather than
    assumed away by the type annotation.

    Returns:
        A list of error messages. An empty list means the catalog is
        safe to use; callers should treat any non-empty result as fatal.
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

            # Self-containment (R8, design doc §7.3): a required_tokens
            # entry that references "await" means the snippet requires an
            # `async` enclosing scope. Injection is pure addition (V2), so
            # the snippet must declare that scope itself rather than
            # depend on the surrounding code being async -- otherwise
            # generation is structurally forced to rewrite the enclosing
            # function signature, which V2 (by design) rejects.
            #
            # Checked against each pattern's own source text (not by
            # executing it against the bare string "await"): a token like
            # r"\bawait\s+api\." requires more context than "await" alone
            # to match, so p.search("await") would miss it and silently
            # skip this check for exactly the tokens it exists to catch.
            # Matched with a word boundary (_pattern_references_keyword,
            # not a raw substring test) so an unrelated token like
            # r"\bawaited\b" or r"\bunawaited\b" -- which contains "await"
            # as a substring but doesn't reference the keyword -- doesn't
            # misfire.
            if any(
                _pattern_references_keyword(p.pattern, _SCOPE_DEPENDENT_TOKEN_RE)
                for p in compiled_tokens
            ):
                for lang, snippet in snippets.items():
                    if not isinstance(snippet, str):
                        continue
                    if not _ASYNC_SCOPE_RE.search(snippet):
                        errors.append(
                            f"rule {rule_id!r}: required_tokens requires "
                            f"'await' but language_snippets[{lang!r}] does "
                            "not declare its own 'async' scope (violates "
                            "self-containment principle, see "
                            "docs/eval-seeded-mutation-injection-design.md "
                            f"§7.3): {snippet!r}"
                        )
                if line_snippet is not None and not _ASYNC_SCOPE_RE.search(
                    line_snippet
                ):
                    errors.append(
                        f"rule {rule_id!r}: required_tokens requires 'await' "
                        "but line_snippet does not declare its own 'async' "
                        "scope (violates self-containment principle, see "
                        "docs/eval-seeded-mutation-injection-design.md "
                        f"§7.3): {line_snippet!r}"
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
    hunk to attach them to.

    Returns:
        A list of hunks, each a list of that hunk's lines (header
        first). Empty if the patch has no hunk header at all.
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

    Returns:
        The new-file start line ``c``, or ``1`` when ``header_line``
        doesn't match the hunk header pattern.
    """
    m = _HUNK_HEADER_RE.match(header_line)
    return int(m.group(1)) if m else 1


def count_new_lines_before(hunk_lines: list[str], insertion_idx: int) -> int:
    """Count new-file lines consumed between the hunk header and insertion_idx.

    Context (` `) and added (`+`) lines advance the new file's line
    counter; removed (`-`) lines do not, since they are absent from the
    new file.

    Returns:
        The count of context/added lines between the hunk header and
        ``insertion_idx`` (inclusive).
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

    Returns:
        The index in ``hunk_lines`` to insert after, chosen per the
        preference order above.
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


_NO_NEWLINE_MARKER = "\\ No newline at end of file"


def verify_diff_parses(mutated_patch: str) -> bool:
    """Phase 2 post-generation check V1: is `mutated_patch` a syntactically
    well-formed unified diff?

    Reuses `split_hunks()` (Phase 1) rather than introducing a new parser
    or external dependency (design doc 3.2.3 V1 rationale). Deliberately
    stricter than `inject_patch()`'s best-effort legacy fallback: an LLM
    output that doesn't parse cleanly should fail closed here, not be
    salvaged.

    Args:
        mutated_patch: LLM-generated unified diff to validate.

    Returns:
        True if `mutated_patch` has at least one hunk, has no non-blank
        preamble before the first hunk header, and every body line is a
        valid context/added/removed line (or the standard `\\ No newline
        at end of file` marker).
    """
    if not mutated_patch.strip():
        return False

    saw_header = False
    for line in mutated_patch.splitlines():
        if _HUNK_HEADER_RE.match(line):
            saw_header = True
            continue
        if not saw_header:
            # split_hunks() silently discards anything before the first
            # hunk header, so a preamble (e.g. a full `git diff`'s
            # `diff --git`/`index`/`---`/`+++` lines) must be rejected
            # here explicitly -- otherwise it would slip past V1
            # unvalidated and still end up in the final seeded item.
            if line.strip():
                return False
            continue
        if line == _NO_NEWLINE_MARKER:
            # Standard git marker for a line lacking a trailing newline;
            # neither a preamble line nor a context/added/removed line,
            # but still valid unified diff content.
            continue
        if line[:1] not in (" ", "+", "-"):
            return False
    return saw_header


def _normalize_diff_line_for_compare(line: str) -> str:
    """Normalize a diff line's content for indentation/semicolon-tolerant
    comparison in `_hunk_added_indices`.

    Design doc 7.4.1 (Issue #131, 1/7 false-negative case): an LLM
    reproducing a pre-existing line verbatim but with different
    indentation or a dropped/added trailing semicolon must not be treated
    as an altered line. Only the diff marker (`+`/`-`/` `) is kept exact;
    the body has its leading/trailing whitespace and one trailing
    semicolon stripped. Internal whitespace is deliberately left intact
    (not collapsed run-by-run): collapsing it would also normalize
    whitespace inside string/regex literals, silently treating a genuine
    content change (e.g. `"a  b"` -> `"a b"`) as formatting-only and
    letting it slip past V2 undetected. Other genuine content changes
    (different tokens, restructured expressions) still differ after
    normalization and are correctly rejected.

    Known limitation (design doc 7.9): this compares the body as a plain
    string, with no notion of whether a line sits inside a multi-line
    string/template literal. On such a continuation line, leading
    whitespace is part of the literal's value, so a pure reindent there
    is a genuine content change that this normalization would still
    treat as formatting-only. Detecting that requires tracking
    quote/backtick nesting across the whole hunk (or file), which is out
    of scope for this lightweight lexical comparison; see design doc 7.9
    for why the trade-off is accepted as-is.

    Args:
        line: A single diff line, including its leading marker
            (`+`/`-`/` `).

    Returns:
        The marker unchanged, followed by the body with leading/trailing
        whitespace and at most one trailing semicolon stripped.
    """
    if not line:
        return line
    marker, body = line[0], line[1:]
    return marker + body.strip().removesuffix(";")


def _hunk_added_indices(
    original_hunk: list[str], mutated_hunk: list[str]
) -> list[int] | None:
    """Match `original_hunk`'s body lines as an ordered subsequence of
    `mutated_hunk`'s body lines.

    Hunk headers (index 0) are excluded from the comparison since design
    doc 3.2.2 explicitly allows them to be rewritten to reflect the new
    line count after insertion.

    Args:
        original_hunk: One hunk (header at index 0) from the original
            patch, as returned by `split_hunks()`.
        mutated_hunk: The corresponding hunk from the mutated patch.

    Returns:
        Indices (into `mutated_hunk`) of lines that are new relative to
        `original_hunk`, or None if any line in `mutated_hunk` is neither
        the next expected original line (allowing whitespace/trailing-
        semicolon differences, design doc 7.4.1) nor a new `+` line --
        i.e. an existing context/removed/added line was altered in
        content, reordered, or dropped -- or if `original_hunk` wasn't
        fully consumed by the end.
    """
    oi = 1
    new_idxs: list[int] = []
    for i in range(1, len(mutated_hunk)):
        line = mutated_hunk[i]
        if oi < len(original_hunk) and (
            line == original_hunk[oi]
            or _normalize_diff_line_for_compare(line)
            == _normalize_diff_line_for_compare(original_hunk[oi])
        ):
            oi += 1
        elif line.startswith("+"):
            new_idxs.append(i)
        else:
            return None
    if oi != len(original_hunk):
        return None
    return new_idxs


def verify_only_additions_changed(original_patch: str, mutated_patch: str) -> bool:
    """Phase 2 post-generation check V2: relative to `original_patch`, does
    `mutated_patch` differ only by newly inserted `+` lines?

    Extends the design doc's literal wording ("deleted/context lines
    remain") to also protect the original patch's own `+` lines (the real
    PR's actual change) from being altered -- an LLM rewriting an
    unrelated line while "injecting" a mutation elsewhere is exactly the
    kind of uncontrolled edit this safety net exists to catch. Also
    rejects a `mutated_patch` identical to `original_patch`, since zero
    added lines means nothing was injected at all.

    Args:
        original_patch: Unified diff before mutation.
        mutated_patch: LLM-generated unified diff to validate against
            `original_patch`.

    Returns:
        True if every hunk's pre-existing lines survive verbatim and in
        order, with at least one new `+` line added somewhere.
    """
    original_hunks = split_hunks(original_patch)
    mutated_hunks = split_hunks(mutated_patch)
    if not original_hunks or len(original_hunks) != len(mutated_hunks):
        return False

    total_new = 0
    for orig_hunk, mut_hunk in zip(original_hunks, mutated_hunks):
        new_idxs = _hunk_added_indices(orig_hunk, mut_hunk)
        if new_idxs is None:
            return False
        total_new += len(new_idxs)
    return total_new > 0


def verify_required_tokens(
    original_patch: str, mutated_patch: str, required_tokens: list[str]
) -> bool:
    """Phase 2 post-generation check V3: do all of the rule's
    `required_tokens` regexes match somewhere across the lines newly
    inserted by this mutation (not the original patch's own `+` lines)?

    Matching is restricted to lines identified as new by
    `_hunk_added_indices()` (the same hunk-diff matching
    `verify_only_additions_changed` uses), rather than every `+` line in
    `mutated_patch`. Otherwise, if the original PR's own pre-existing
    code already happens to contain a required token (`await` is
    extremely common, for instance), a broken or no-op injection could
    still pass V3 by coincidence -- real review finding on PR #122.
    Matching is done against the new lines concatenated, not per-line,
    since some rules need tokens that a natural injection may split
    across lines (e.g. `frontend_n_plus_one_api` needs a loop keyword and
    `await`, which commonly land on different lines of a multi-line
    block).

    Args:
        original_patch: Unified diff before mutation.
        mutated_patch: LLM-generated unified diff to validate.
        required_tokens: Regex patterns from the rule's catalog entry;
            all must match for the check to pass.

    Returns:
        True if `required_tokens` is non-empty, the hunk structure
        between `original_patch` and `mutated_patch` is consistent (per
        `_hunk_added_indices`), and every pattern matches somewhere in
        the concatenated newly-inserted lines.
    """
    if not required_tokens:
        return False

    original_hunks = split_hunks(original_patch)
    mutated_hunks = split_hunks(mutated_patch)
    if not original_hunks or len(original_hunks) != len(mutated_hunks):
        return False

    new_lines: list[str] = []
    for orig_hunk, mut_hunk in zip(original_hunks, mutated_hunks):
        new_idxs = _hunk_added_indices(orig_hunk, mut_hunk)
        if new_idxs is None:
            return False
        new_lines.extend(mut_hunk[i][1:] for i in new_idxs)

    joined = "\n".join(new_lines)
    return all(re.search(pattern, joined) for pattern in required_tokens)


def verify_runtime_consistency(mutated_patch: str, runtime: str | None) -> bool:
    """Phase 2 post-generation check V4: for a rule whose target runtime is
    `"node"`, forbid browser-only globals (`window.`/`document.`) in
    `mutated_patch`'s added (`+`) lines.

    Unlike V3, this scans every `+` line in `mutated_patch` -- including
    the original PR's own pre-existing additions, not just the newly
    injected ones. That is deliberately left broad rather than narrowed
    to match V3: this check only ever *rejects* (fails closed), so
    scanning pre-existing lines can at worst cause an unrelated,
    legitimate `+` line to trigger a false rejection (falling back to
    Phase 1), never let a bad injection through -- the opposite risk
    profile from V3's leak, which caused an incorrect *accept*.

    No current catalog rule declares `runtime: "node"` (all 5 are
    `"universal"` or `"browser"`), so this check is a no-op against
    today's catalog -- it exists as a forward-looking guard for when a
    Node-specific rule is added, not because it currently rejects
    anything. The inverse direction (Node-only APIs leaking into a
    browser-only file) is intentionally out of scope; see design doc
    3.2.3.

    Args:
        mutated_patch: LLM-generated unified diff to validate.
        runtime: The rule's declared runtime (`"browser"`, `"node"`, or
            `"universal"`).

    Returns:
        True unless `runtime == "node"` and a `window.`/`document.`
        reference appears in any added (`+`) line of `mutated_patch`.
    """
    if runtime != "node":
        return True
    added_lines = [
        line
        for hunk in split_hunks(mutated_patch)
        for line in hunk[1:]
        if line.startswith("+")
    ]
    return not any(_FORBIDDEN_GLOBAL_RE.search(line) for line in added_lines)


def recompute_injected_line(original_patch: str, mutated_patch: str) -> int | None:
    """Deterministically recompute the new-file line number of the
    injected block, ignoring the LLM's self-reported `injected_line`
    entirely.

    `injected_line` is an unverified LLM self-report -- none of V1-V4
    check it against the actual `mutated_patch` content. Trusting it
    directly for `must_find` would reopen, one layer up, exactly the
    failure mode (R4: must_find line number correctness) that motivated
    this whole redesign (see design doc 1.1/2 R4 and the "R4に関する注").
    So instead, the single contiguous block of new `+` lines is located
    via the same hunk-diff matching `verify_only_additions_changed` uses,
    and its new-file line number is computed with Phase 1's own
    `parse_hunk_new_start` + `count_new_lines_before` -- the same
    computation Phase 1's own `inject_patch()` uses, so both code paths
    agree on what "the line number" means.

    Args:
        original_patch: Unified diff before mutation.
        mutated_patch: Verified unified diff after mutation (callers
            should only invoke this once `verify_only_additions_changed`
            has already returned True).

    Returns:
        The 1-based new-file line number of the injected block, or None
        (a verification failure that should trigger fallback to Phase 1)
        when the changed hunk can't be uniquely identified, or its new
        lines aren't contiguous -- both cases where "the" injected line
        is ambiguous.
    """
    original_hunks = split_hunks(original_patch)
    mutated_hunks = split_hunks(mutated_patch)
    if not original_hunks or len(original_hunks) != len(mutated_hunks):
        return None

    changed: tuple[list[str], list[int]] | None = None
    for orig_hunk, mut_hunk in zip(original_hunks, mutated_hunks):
        new_idxs = _hunk_added_indices(orig_hunk, mut_hunk)
        if new_idxs is None:
            return None
        if new_idxs:
            if changed is not None:
                return None  # more than one hunk changed: ambiguous
            changed = (mut_hunk, new_idxs)

    if changed is None:
        return None
    mut_hunk, new_idxs = changed
    if new_idxs != list(range(new_idxs[0], new_idxs[0] + len(new_idxs))):
        return None  # non-contiguous new lines: ambiguous which is "the" line

    base_line = parse_hunk_new_start(mut_hunk[0])
    consumed = count_new_lines_before(mut_hunk, new_idxs[0] - 1)
    return base_line + consumed


def candidate_files(gold_item: dict[str, Any]) -> list[dict[str, Any]]:
    """Pick the file_changes eligible as a mutation target.

    Prefers production files (non-test, with a non-empty patch) over test
    files so agents see realistic vulnerabilities; falls back to all
    file_changes when no production file qualifies.

    Returns:
        The subset of ``gold_item["file_changes"]`` that qualify as
        production candidates, or all ``file_changes`` if none do.
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

    Returns:
        A list of ``(file_change, rule)`` pairs valid for this item.
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
    """Build one Seeded item from an already-chosen (file_change, rule) combo
    using the Phase 1 deterministic injection logic.

    Args:
        gold_item: Source Gold set item.
        file_change: The specific file_change to mutate.
        rule: Mutation catalog rule for this combo.

    Returns:
        A Seeded item dict with `generation_source: "deterministic_fallback"`.
    """
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
        "generation_source": "deterministic_fallback",
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


def passes_post_generation_checks(
    original_patch: str, mutated_patch: str, rule: dict[str, Any]
) -> bool:
    """Apply V1 -> V2 -> V3 -> V4 (design doc 3.2.3) in order, short-circuiting
    on the first failure since later checks assume `split_hunks()` on
    `mutated_patch` is trustworthy, which V1 establishes.

    Args:
        original_patch: Unified diff before mutation.
        mutated_patch: LLM-generated unified diff to validate.
        rule: Mutation catalog rule (must have `required_tokens`,
            `runtime`).

    Returns:
        True if `mutated_patch` passes all four checks.
    """
    return (
        verify_diff_parses(mutated_patch)
        and verify_only_additions_changed(original_patch, mutated_patch)
        and verify_required_tokens(
            original_patch, mutated_patch, rule.get("required_tokens", [])
        )
        and verify_runtime_consistency(mutated_patch, rule.get("runtime"))
    )


def render_seeded_item_from_llm(
    gold_item: dict[str, Any],
    file_change: dict[str, Any],
    rule: dict[str, Any],
    llm_output: MutatedPatchOutput,
    injected_line: int,
) -> dict[str, Any]:
    """Build one Seeded item from a verified LLM mutation.

    Args:
        gold_item: Source Gold set item.
        file_change: The specific file_change being mutated.
        rule: Mutation catalog rule (must have `rule_id`, `category`,
            `severity`, `summary`).
        llm_output: Verified LLM structured output (must already have
            passed `passes_post_generation_checks`).
        injected_line: The deterministically recomputed line number
            (`recompute_injected_line()`), not `llm_output.injected_line`
            -- see the "injected_line に関する注" in the design doc.

    Returns:
        A Seeded item dict with `generation_source: "llm"`.
    """
    path = file_change.get("path", "")
    file_changes = gold_item.get("file_changes", [])
    seeded_changes = [
        {"path": path, "patch": llm_output.mutated_patch} if fc is file_change else fc
        for fc in file_changes
    ]

    return {
        "id": f"seeded::{gold_item['id']}::{rule['rule_id']}::{path}",
        "base_source": gold_item["id"],
        "repository": gold_item["repository"],
        "pr_number": gold_item["pr_number"],
        "file_changes": seeded_changes,
        "generation_source": "llm",
        "reachability_rationale": llm_output.reachability_rationale,
        "must_find": [
            {
                "rule_id": rule["rule_id"],
                "category": rule["category"],
                "severity": rule["severity"],
                "path": path,
                "line": injected_line,
                "summary": rule["summary"],
            }
        ],
    }


def render_seeded_item_with_generation(
    gold_item: dict[str, Any],
    file_change: dict[str, Any],
    rule: dict[str, Any],
    generate_fn: MutationGenerator | None = None,
    max_attempts: int = 1,
) -> dict[str, Any]:
    """Try the LLM generation path (design doc 3.2.1) up to `max_attempts`
    times; fall back to the Phase 1 deterministic path if `generate_fn` is
    unset, or every attempt either fails the LLM call, doesn't pass V1-V4,
    or has an injected line that can't be unambiguously recomputed.

    Design doc 9.4 reverses 3.2.3's original "no retry" decision: each
    attempt is independently gated by the same `passes_post_generation_checks`
    (V1-V4), so a bounded retry cannot let a lower-quality generation
    through -- it only gives a generation that would have passed on a later
    attempt a chance to be found, given the high attempt-to-attempt
    variance measured in 9.2.

    Args:
        gold_item: Source Gold set item.
        file_change: The specific file_change to mutate.
        rule: Mutation catalog rule for this combo.
        generate_fn: Optional LLM mutation generator (from
            `make_llm_mutation_generator`). Defaults to None, which
            skips the LLM path entirely for backward compatibility.
        max_attempts: Maximum number of `generate_fn` calls to try before
            falling back. Defaults to 1 (no retry), preserving prior
            behavior for existing callers.

    Returns:
        A Seeded item dict, with `generation_source` set to `"llm"` or
        `"deterministic_fallback"` depending on which path produced it.
    """
    if generate_fn is not None:
        path = file_change.get("path", "")
        original_patch = file_change.get("patch") or ""
        lang = detect_lang(path)
        for _ in range(max(max_attempts, 1)):
            llm_output = generate_fn(original_patch, rule, lang)
            if llm_output is None or not passes_post_generation_checks(
                original_patch, llm_output.mutated_patch, rule
            ):
                continue
            injected_line = recompute_injected_line(
                original_patch, llm_output.mutated_patch
            )
            if injected_line is None:
                continue
            return render_seeded_item_from_llm(
                gold_item, file_change, rule, llm_output, injected_line
            )

    return render_seeded_item(gold_item, file_change, rule)


def build_seeded_items(
    gold_item: dict[str, Any],
    rules: list[dict[str, Any]],
    rnd: random.Random,
    multiplier: int,
    generate_fn: MutationGenerator | None = None,
    max_attempts: int = 1,
) -> tuple[list[dict[str, Any]], str | None]:
    """Build up to `multiplier` distinct Seeded items for one Gold item.

    Samples (file, rule) combos WITHOUT replacement: enumerates the full
    valid combo pool, shuffles it deterministically with `rnd`, then takes
    the first min(multiplier, len(pool)) entries. Shuffle-then-slice is
    used instead of retry-on-duplicate because retrying is unbounded/
    wasteful once the pool is nearly exhausted.

    Args:
        gold_item: Source Gold set item.
        rules: Full mutation catalog rule list.
        rnd: Seeded random source, used only to shuffle the combo pool
            (R6 reproducibility).
        multiplier: Requested Seeded items per Gold item; clamped to the
            pool size if it exceeds it.
        generate_fn: Optional LLM mutation generator (from
            `make_llm_mutation_generator`). Defaults to None for backward
            compatibility: existing callers that don't pass it keep
            getting the pure Phase 1 path via
            `render_seeded_item_with_generation`'s own None-handling.
        max_attempts: Passed through to `render_seeded_item_with_generation`
            (design doc 9.4). Defaults to 1 (no retry).

    Returns:
        A tuple of `(items, warning)`. `items` is `[]` when the pool is
        empty (no candidate file's language matches any rule), matching
        prior silent-skip behavior. `warning` is non-None when
        `multiplier` exceeds the pool size, in which case the requested
        count is clamped to the pool size.
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

    items = [
        render_seeded_item_with_generation(
            gold_item, fc, rule, generate_fn, max_attempts
        )
        for fc, rule in pool[:take]
    ]
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
    parser.add_argument(
        "--model-id",
        default=None,
        help=(
            "OpenAI-compatible model id for Seeded mutation generation "
            "(LLM, Phase2). Falls back to SEEDED_GEN_MODEL_ID; error if "
            "neither is set."
        ),
    )
    parser.add_argument(
        "--llm-base-url",
        default=None,
        help=(
            "Optional OpenAI-compatible base URL for Seeded mutation "
            "generation. Falls back to SEEDED_GEN_LLM_BASE_URL."
        ),
    )
    parser.add_argument(
        "--llm-max-attempts",
        type=int,
        default=3,
        help=(
            "Max LLM generation attempts per (file, rule) combo before "
            "falling back to Phase 1 (design doc 9.4). Each attempt is "
            "independently gated by V1-V4; defaults to 3, the value "
            "measured in design doc 9.7-9.8 to bring fallback under 30%% "
            "when combined with a sufficiently capable generation model."
        ),
    )
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

    if args.llm_max_attempts < 1:
        print(
            f"[SEEDED-ERROR] --llm-max-attempts must be >= 1, got "
            f"{args.llm_max_attempts!r} (each attempt is independently "
            "checked by the post-generation verifiers -- pass 1 to "
            "disable retries, not 0)",
            file=sys.stderr,
        )
        return 1

    model_id = args.model_id or os.environ.get("SEEDED_GEN_MODEL_ID")
    llm_base_url = args.llm_base_url or os.environ.get("SEEDED_GEN_LLM_BASE_URL")
    if not model_id:
        print(
            "[SEEDED-ERROR] no generation model configured: pass --model-id "
            "or set SEEDED_GEN_MODEL_ID (see evaluation/RUNBOOK.md)",
            file=sys.stderr,
        )
        return 1
    generate_fn = make_llm_mutation_generator(model_id, llm_base_url)

    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    count = 0
    with open(args.output, "w", encoding="utf-8") as out:
        for item in gold_items:
            items, warning = build_seeded_items(
                item, rules, rnd, args.multiplier, generate_fn, args.llm_max_attempts
            )
            if warning:
                print(warning, file=sys.stderr)
            for seeded in items:
                out.write(json.dumps(seeded, ensure_ascii=False) + "\n")
                count += 1

    print(f"Done. Seeded items: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
