"""Shared helpers for testing standalone scripts under evaluation/tools/.

evaluation/tools/*.py are not part of the code_review_agent package (no
__init__.py, run directly as scripts), so they are loaded by file path
instead of a normal package import.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

EVAL_TOOLS_DIR = Path(__file__).resolve().parent.parent.parent / "evaluation" / "tools"


def load_eval_tool_module(name: str, filename: str) -> ModuleType:
    """Load a module from evaluation/tools/<filename> under the given name.

    evaluation/tools is added to sys.path so sibling imports used by the
    scripts themselves (e.g. ``from a2a_client import ...``) keep working.
    """
    tools_dir_str = str(EVAL_TOOLS_DIR)
    if tools_dir_str not in sys.path:
        sys.path.insert(0, tools_dir_str)

    spec = importlib.util.spec_from_file_location(name, EVAL_TOOLS_DIR / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
