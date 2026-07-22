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
_ANGULAR_MANIFEST = "angular.json"
_ANGULAR_SOURCE_SUFFIXES = (
    ".component.ts",
    ".service.ts",
    ".directive.ts",
    ".pipe.ts",
)
_SVELTE_CONFIGS = ("svelte.config.js", "svelte.config.ts")
_SVELTE_SOURCE_SUFFIX = ".svelte"

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

    Two signals are combined: the PR-changed files and ``dependency_files``.
    Detection is ordered by specificity so the coarse TypeScript and
    ``package.json`` signals do not misclassify framework projects as React.
    Angular is checked first (``angular.json`` or an Angular source naming
    convention), then Svelte (a ``svelte.config.js``/``.ts`` manifest or a
    ``.svelte`` file). Otherwise, a TS/JS/JSX change or ``package.json``
    qualifies the repository as React/TypeScript.

    Note:
        Angular takes priority over Svelte, and both take priority over the
        coarse React/TypeScript heuristic, in mixed-signal repositories.
        Because ``dependency_files`` is repository-level, a PR that changes
        only non-stack files in a JS/TS repo can still be detected as
        React/TypeScript via ``package.json``.

    Args:
        pr_info: Structured PR information from the PR Info Collector.

    Returns:
        The set of detected project types (empty when none match).
    """
    paths = [change.filePath for change in pr_info.pr_info.file_changes]
    dependency_files = set(pr_info.dependency_files)
    all_files = dependency_files | set(paths)

    has_angular_manifest = any(
        path == _ANGULAR_MANIFEST or path.endswith(f"/{_ANGULAR_MANIFEST}")
        for path in all_files
    )
    has_angular_source = any(path.endswith(_ANGULAR_SOURCE_SUFFIXES) for path in paths)
    if has_angular_manifest or has_angular_source:
        return {ProjectType.ANGULAR}

    has_svelte_manifest = any(
        path == config or path.endswith(f"/{config}")
        for config in _SVELTE_CONFIGS
        for path in all_files
    )
    has_svelte_source = any(path.endswith(_SVELTE_SOURCE_SUFFIX) for path in paths)
    if has_svelte_manifest or has_svelte_source:
        return {ProjectType.SVELTE}

    has_package_json = "package.json" in dependency_files or any(
        path.endswith("package.json") for path in paths
    )
    has_ts_js = any(path.endswith((".ts", ".tsx", ".js", ".jsx")) for path in paths)

    detected: set[ProjectType] = set()
    if has_ts_js or has_package_json:
        detected.add(ProjectType.REACT_TS)
    return detected
