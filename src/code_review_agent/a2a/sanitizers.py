"""Helpers for stripping credential-like strings from error messages."""

import re

_TOKEN_PATTERN = re.compile(r"(Bearer\s+|ghp_|github_pat_)[^\s\"']+", re.IGNORECASE)


def sanitize_error(exc: BaseException) -> str:
    """Remove token-like strings from exception messages to prevent credential leakage.

    Returns:
        The exception's string representation with any ``Bearer ...``,
        ``ghp_...``, or ``github_pat_...`` token replaced by ``[REDACTED]``.
    """
    return _TOKEN_PATTERN.sub("[REDACTED]", str(exc))
