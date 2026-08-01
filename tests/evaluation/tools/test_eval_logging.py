"""Tests for evaluation/tools/eval_logging.py."""

from __future__ import annotations

import logging

import pytest

from tests.evaluation.conftest import load_eval_tool_module

eval_logging = load_eval_tool_module("eval_logging", "eval_logging.py")


@pytest.fixture(autouse=True)
def _restore_root_logger():
    root = logging.getLogger()
    original_handlers = list(root.handlers)
    original_level = root.level
    yield
    root.handlers = original_handlers
    root.setLevel(original_level)


def _clear_handlers() -> None:
    """Remove pytest's own root handler(s) for this test.

    pytest re-attaches its ``LogCaptureHandler`` to the root logger right
    before each test function body runs (independent of fixture
    teardown), so clearing in a fixture's pre-yield section doesn't
    survive to the test body. basicConfig() (no force=True) only
    configures when root has no handlers, so the test body must clear
    immediately before calling setup_logging() to see it configure at
    all -- this mirrors production (a fresh process, no prior handlers).
    """
    logging.getLogger().handlers.clear()


class TestSetupLogging:
    def test_configures_a_single_handler_with_timestamp_and_level(self):
        _clear_handlers()
        eval_logging.setup_logging()

        root = logging.getLogger()
        assert len(root.handlers) == 1
        formatter = root.handlers[0].formatter
        assert formatter is not None
        fmt = formatter._fmt
        assert fmt is not None
        assert "%(asctime)s" in fmt
        assert "%(levelname)s" in fmt

    def test_calling_twice_does_not_duplicate_handlers(self):
        _clear_handlers()
        eval_logging.setup_logging()
        eval_logging.setup_logging()

        assert len(logging.getLogger().handlers) == 1

    def test_level_is_applied_to_root_logger(self):
        _clear_handlers()
        eval_logging.setup_logging(level=logging.DEBUG)

        assert logging.getLogger().level == logging.DEBUG
