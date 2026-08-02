"""Shared logging configuration for evaluation/tools scripts."""

import logging


def setup_logging(level: int = logging.INFO) -> None:
    """Configure the root logger for evaluation/tools scripts.

    Deliberately omits ``force=True``: ``basicConfig`` already no-ops when
    the root logger has a handler, which is exactly what's wanted here --
    a second call (or a process where something else, e.g. pytest's
    ``caplog``, already attached a handler) leaves the existing setup
    alone instead of tearing it down. Only a ``StreamHandler`` is
    attached, which defaults to ``sys.stderr`` -- stdout stays free for
    scripts that print machine-readable JSON.
    """
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
