"""Reviewer registry and project-type detection.

This module is the extension point of the parallel review stage.  Reviewers
register themselves with :func:`register_reviewer`; the orchestrator asks
:func:`get_reviewer_classes` which reviewers apply to a given project type and
optional set of perspectives.  Adding a new project type or perspective is a
matter of writing a reviewer class and registering it — no change to the
orchestrator or this module's selection logic is required.
"""

from collections.abc import Iterable
from typing import TypeVar

from ..models.pr_info import PRInfoResult
from ..models.review import ProjectType, ReviewPerspective
from .base_reviewer import ReviewAgent

_REGISTRY: list[type[ReviewAgent]] = []

_ReviewerT = TypeVar("_ReviewerT", bound=ReviewAgent)


def register_reviewer(cls: type[_ReviewerT]) -> type[_ReviewerT]:
    """Register a reviewer class so the orchestrator can discover it.

    Intended for use as a class decorator.  The class declares its scope via
    its ``perspective`` and ``project_types`` metadata.  The concrete class
    type is preserved so decorated reviewers keep their own attributes.

    Args:
        cls: The reviewer class to register.

    Returns:
        The same class, unchanged, so it can be used as a decorator.
    """
    _REGISTRY.append(cls)
    return cls


def get_registered_reviewers() -> list[type[ReviewAgent]]:
    """Return a copy of all registered reviewer classes.

    Returns:
        A shallow copy of the registry, safe for callers to iterate or store
        without mutating the registry itself.
    """
    return list(_REGISTRY)


def get_reviewer_classes(
    project_type: ProjectType,
    perspectives: Iterable[ReviewPerspective] | None = None,
) -> list[type[ReviewAgent]]:
    """Select reviewer classes applicable to a project type.

    Args:
        project_type: The project type to select reviewers for.
        perspectives: Optional set of perspectives to restrict the selection
            to.  When ``None``, all perspectives are included.

    Returns:
        Registered reviewer classes that apply to ``project_type`` and, when
        given, match one of ``perspectives``.
    """
    allowed = set(perspectives) if perspectives is not None else None
    selected: list[type[ReviewAgent]] = []
    for cls in _REGISTRY:
        if project_type not in cls.project_types:
            continue
        if allowed is not None and cls.perspective not in allowed:
            continue
        selected.append(cls)
    return selected


def detect_project_types(pr_info: PRInfoResult) -> set[ProjectType]:
    """Infer applicable project types from collected PR information.

    Used as the default reviewer selection when the caller does not specify a
    project type explicitly.  New stacks add their own branch here (for
    example ``pom.xml``/``build.gradle`` for Spring Boot).

    The signal is the changed files, since ``dependency_files`` only lists
    manifests *changed* by the PR — a typical PR touching only ``src/*.tsx``
    changes no manifest, so requiring ``package.json`` would miss it.  A
    TS/JS/JSX change alone is therefore treated as a React/TypeScript signal,
    and a ``package.json`` change (e.g. a dependency bump) qualifies on its own.

    Note:
        This is a heuristic over PR-changed files only.  A more reliable
        repository-level stack signal (e.g. reading the root ``package.json``)
        is a future enhancement once that input is available here.

    Args:
        pr_info: Structured PR information from the PR Info Collector.

    Returns:
        The set of detected project types (empty when none match).
    """
    paths = [change.filePath for change in pr_info.pr_info.file_changes]
    dependency_files = set(pr_info.dependency_files)

    has_package_json = "package.json" in dependency_files or any(
        path.endswith("package.json") for path in paths
    )
    has_ts_js = any(path.endswith((".ts", ".tsx", ".js", ".jsx")) for path in paths)

    detected: set[ProjectType] = set()
    if has_ts_js or has_package_json:
        detected.add(ProjectType.REACT_TS)
    return detected
