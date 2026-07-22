"""Reviewer registry and project-type detection.

This module is the extension point of the parallel review stage.  Reviewers
register themselves with :func:`register_reviewer`; the orchestrator asks
:func:`get_reviewer_classes` which reviewers apply to a given project type and
optional set of perspectives.  Adding a new project type or perspective is a
matter of writing a reviewer class and registering it — no change to the
orchestrator or this module's selection logic is required.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import TypeVar

from ..models.pr_info import PRInfoResult
from ..models.review import ProjectType, ReviewPerspective
from .base_reviewer import ReviewAgent

_REGISTRY: list[type[ReviewAgent]] = []

_ReviewerT = TypeVar("_ReviewerT", bound=ReviewAgent)


@dataclass(frozen=True)
class _DetectionRule:
    """A single project-type detection rule.

    Rules are evaluated in list order, so earlier (more specific) rules take
    priority over later (coarser) ones in mixed-signal repositories. A rule
    matches when any of its manifest names or source suffixes is present.

    Args:
        project_type: The project type produced when this rule matches.
        manifests: Manifest basenames matched against repository-level files
            (PR-changed files plus ``dependency_files``). Matching is exact on
            the basename, so ``not-package.json`` does not match ``package.json``.
        source_suffixes: Path suffixes matched against PR-changed files only,
            so a repository-wide dependency listing does not falsely qualify a
            stack that the PR did not actually touch.
    """

    project_type: ProjectType
    manifests: tuple[str, ...] = ()
    source_suffixes: tuple[str, ...] = ()


def _matches_manifest(path: str, name: str) -> bool:
    """Return True when ``path``'s basename is exactly ``name``.

    Args:
        path: Repository-relative file path.
        name: Manifest basename to match (for example ``package.json``).

    Returns:
        True when ``path`` is ``name`` or ends with ``/name``, so unrelated
        files such as ``not-package.json`` do not match.
    """
    return path == name or path.endswith(f"/{name}")


_ANGULAR_SOURCE_SUFFIXES = (
    ".component.ts",
    ".service.ts",
    ".directive.ts",
    ".pipe.ts",
)

# Ordered by specificity: framework rules precede the coarse React/TypeScript
# rule so a JS/TS or ``package.json`` signal does not misclassify an Angular or
# Svelte project as React. Adding a stack means adding a rule here (and, when
# the stack ships a reviewer, registering that reviewer).
_DETECTION_RULES: tuple[_DetectionRule, ...] = (
    _DetectionRule(
        project_type=ProjectType.ANGULAR,
        manifests=("angular.json",),
        source_suffixes=_ANGULAR_SOURCE_SUFFIXES,
    ),
    _DetectionRule(
        project_type=ProjectType.SVELTE,
        manifests=("svelte.config.js", "svelte.config.ts"),
        source_suffixes=(".svelte",),
    ),
    _DetectionRule(
        project_type=ProjectType.REACT_TS,
        manifests=("package.json",),
        source_suffixes=(".ts", ".tsx", ".js", ".jsx"),
    ),
)


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
    project type explicitly. Detection is driven by :data:`_DETECTION_RULES`,
    an ordered table; adding a new stack (for example ``pom.xml`` for Spring
    Boot) means adding a rule there rather than editing this function.

    Two signals are combined: the PR-changed files and ``dependency_files``.
    A rule's ``manifests`` are matched against both (repository-level), while
    its ``source_suffixes`` are matched against PR-changed files only. Rules
    are evaluated in order and the first match wins, so more specific framework
    rules precede the coarse React/TypeScript rule.

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
    all_files = set(pr_info.dependency_files) | set(paths)

    for rule in _DETECTION_RULES:
        has_manifest = any(
            _matches_manifest(path, name)
            for name in rule.manifests
            for path in all_files
        )
        has_source = any(path.endswith(rule.source_suffixes) for path in paths)
        if has_manifest or has_source:
            return {rule.project_type}
    return set()
