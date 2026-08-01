"""Shared logging configuration for evaluation/tools scripts."""

import logging


def setup_logging(level: int = logging.INFO) -> None:
    """Configure the root logger for evaluation/tools scripts.

    Uses ``force=True`` so repeated calls (or a pre-existing basicConfig
    elsewhere in the process) don't stack duplicate handlers. Only a
    ``StreamHandler`` is attached, which defaults to ``sys.stderr`` --
    stdout stays free for scripts that print machine-readable JSON.
    """
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        force=True,
    )
