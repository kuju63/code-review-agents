#!/usr/bin/env python3
"""Shared selection criteria for evaluation PR targets.

Single source of truth for the rules that both the target *producer*
(``discover_candidate_prs.py``) and the Gold *builder* (``build_gold_set.py``)
must agree on, so that a PR admitted by discovery is never silently dropped by
the Gold build. See docs/adr/0005-per-stack-evaluation-target-pipeline.md and
EVALUATION_PLAN.md 2.0.2.

Two criteria live here:

1. Production-code file classification (frontend scope). A changed file counts
   as reviewable production code only when it is a frontend source file (or an
   allow-listed special file such as ``package.json``) and is neither a test
   nor a documentation file.
2. Inline review-comment presence. A PR qualifies only when it has at least one
   non-blank inline review comment attached to a reviewable production file
   (path + line). Review-body-only comments do not qualify because their
   location cannot be evaluated.
"""

from __future__ import annotations

from typing import Any

# Frontend production-code extensions (aligned with the Gold builder scope).
ALLOWED_EXTENSIONS = (
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".vue",
    ".svelte",
    ".css",
    ".scss",
    ".html",
)

# Files that count as production code despite not matching ALLOWED_EXTENSIONS.
SPECIAL_FILES = ("package.json",)

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
    ".test.vue",
    ".spec.vue",
    ".test.svelte",
    ".spec.svelte",
    "/test_",
    "_test.py",
    "/tests/",
    "/test/",
    "/e2e/",
    "/cypress/",
    "/__mocks__/",
)

_DOC_SUFFIXES = (".md", ".mdx", ".rst", ".txt")
_DOC_PATH_PATTERNS = ("/docs/", "/documentation/")


def _normalized_path(path: str) -> str:
    """Normalize a repository-relative path for directory-pattern matching.

    Returns:
        A slash-prefixed path using forward separators.
    """
    return f"/{path.replace('\\\\', '/').lstrip('/')}"


def is_test_file(path: str) -> bool:
    """Return ``True`` when the path matches a configured test-file pattern."""
    normalized = _normalized_path(path)
    return any(pat in normalized for pat in _TEST_PATH_PATTERNS)


def is_doc_file(path: str) -> bool:
    """Return ``True`` when the path is a documentation file."""
    lower = _normalized_path(path).lower()
    if lower.endswith(_DOC_SUFFIXES):
        return True
    return any(pat in lower for pat in _DOC_PATH_PATTERNS)


def is_production_code_file(path: str) -> bool:
    """Return ``True`` when the path is a reviewable frontend production file.

    A file qualifies when it is a frontend source file (or an allow-listed
    special file) and is neither a test nor a documentation file.
    """
    if not path:
        return False
    if is_test_file(path) or is_doc_file(path):
        return False
    if path.endswith(SPECIAL_FILES):
        return True
    return path.endswith(ALLOWED_EXTENSIONS)


def has_production_code_change(files: list[dict[str, Any]]) -> bool:
    """Return ``True`` when at least one changed production file has a patch."""
    return any(
        bool(f.get("patch")) and is_production_code_file(f.get("filename", ""))
        for f in files
    )


def is_qualifying_inline_comment(comment: dict[str, Any]) -> bool:
    """Return ``True`` when an inline comment can seed a Gold finding.

    The comment must be non-blank and attached to a reviewable production file
    (path present and production-code). Author (human or AI bot) is irrelevant.
    """
    body = (comment.get("body") or "").strip()
    path = comment.get("path") or ""
    return bool(body) and is_production_code_file(path)


def has_inline_review_comments(inline: list[dict[str, Any]]) -> bool:
    """Return ``True`` when at least one qualifying inline comment exists."""
    return any(is_qualifying_inline_comment(c) for c in inline)
