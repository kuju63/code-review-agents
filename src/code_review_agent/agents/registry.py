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
from .manifest_detection import (
    collect_direct_package_names,
    detect_project_type_from_packages,
)

_REGISTRY: list[type[ReviewAgent]] = []

# Next.js and Nuxt share their base framework's file extensions entirely, so
# they carry no dedicated reviewer (see manifest_detection.py). A PR detected
# as one of these metaframeworks still gets reviewed by its base framework's
# registered reviewers, so "no NextReviewer yet" never means "no review at
# all" -- see get_reviewer_classes.
_METAFRAMEWORK_BASE: dict[ProjectType, ProjectType] = {
    ProjectType.NEXTJS: ProjectType.REACT_TS,
    ProjectType.NUXT: ProjectType.VUE,
}

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

# Ordered by specificity: framework rules with an unambiguous file pattern
# precede the content-based tier and the coarse React/TypeScript fallback
# (see detect_project_types), so a JS/TS or ``package.json`` signal does not
# misclassify an Angular, Svelte, or Vue project as React. Adding a stack
# with its own unambiguous pattern means adding a rule here (and, when the
# stack ships a reviewer, registering that reviewer); a stack without one
# (a metaframework, or a library sharing its host language's extensions)
# instead belongs in manifest_detection.py's package-name priority table.
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
        project_type=ProjectType.VUE,
        manifests=("vue.config.js", "vue.config.ts"),
        source_suffixes=(".vue",),
    ),
)

# The coarse last-resort fallback (tier 3 of detect_project_types): a PR
# touching package.json or generic TS/JS/JSX files, with no signal from the
# rules above or from manifest content, is assumed to be React/TypeScript.
_COARSE_REACT_MANIFEST = "package.json"
_COARSE_REACT_SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx")


def _matches_manifest_name(paths: set[str], name: str) -> bool:
    """Return True when any path in ``paths`` matches manifest ``name``.

    Args:
        paths: Candidate repository-relative paths.
        name: Manifest basename to match (for example ``package.json``).

    Returns:
        True when any path in ``paths`` is ``name`` or ends with ``/name``.
    """
    return any(_matches_manifest(path, name) for path in paths)


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
        project_type: The project type to select reviewers for. When this is
            a metaframework with no dedicated reviewer (``NEXTJS``, ``NUXT``;
            see :data:`_METAFRAMEWORK_BASE`), reviewers registered for its
            base framework (``REACT_TS``, ``VUE``) are included too, so
            detecting the metaframework never yields zero reviewers.
        perspectives: Optional set of perspectives to restrict the selection
            to.  When ``None``, all perspectives are included.

    Returns:
        Registered reviewer classes that apply to ``project_type`` (or its
        metaframework base) and, when given, match one of ``perspectives``.
    """
    allowed = set(perspectives) if perspectives is not None else None
    matching_types = {project_type}
    base_type = _METAFRAMEWORK_BASE.get(project_type)
    if base_type is not None:
        matching_types.add(base_type)
    selected: list[type[ReviewAgent]] = []
    for cls in _REGISTRY:
        if not (cls.project_types & matching_types):
            continue
        if allowed is not None and cls.perspective not in allowed:
            continue
        selected.append(cls)
    return selected


def detect_project_types(pr_info: PRInfoResult) -> set[ProjectType]:
    """Infer applicable project types from collected PR information.

    Used as the default reviewer selection when the caller does not specify a
    project type explicitly. Detection runs in three tiers, each returning
    immediately on a match (Issue #230):

    1. :data:`_DETECTION_RULES` -- file-extension/manifest-name rules for
       stacks with an unambiguous pattern (Angular, Svelte, Vue). Evaluated
       in order; the first match wins, so more specific framework rules
       precede the coarse React/TypeScript rule below.
    2. Content-based detection via :func:`~.manifest_detection.collect_direct_package_names`
       and :func:`~.manifest_detection.detect_project_type_from_packages`,
       using ``pr_info.manifest_contents`` (``package.json``/lock-file text).
       This resolves what tier 1 cannot: metaframeworks (Next.js, Nuxt) that
       share their base framework's extensions entirely, and any stack whose
       PR touches neither a distinguishing file nor a manifest *filename*
       (only its *content* reveals the framework).
    3. The coarse fallback: a PR touching ``package.json`` or generic
       TS/JS/JSX changes, with no signal from tiers 1-2, is assumed to be
       React/TypeScript.

    Two signals feed tier 1: the PR-changed files and ``dependency_files``. A
    rule's ``manifests`` are matched against both (repository-level), while
    its ``source_suffixes`` are matched against PR-changed files only.

    Note:
        Angular takes priority over Svelte, which takes priority over Vue,
        and all three take priority over content-based detection and the
        coarse React/TypeScript heuristic, in mixed-signal repositories.
        Because ``dependency_files`` is repository-level, a PR that changes
        only non-stack files in a JS/TS repo can still be detected as
        React/TypeScript via ``package.json``. Detecting more than one
        project type for a single PR (for example a monorepo with distinct
        workspace packages on different stacks) is not supported: exactly
        one type is returned whenever any tier matches.

    Args:
        pr_info: Structured PR information from the PR Info Collector.

    Returns:
        The set of detected project types (empty when none match; otherwise
        exactly one).
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

    package_names = collect_direct_package_names(pr_info.manifest_contents)
    content_type = detect_project_type_from_packages(package_names)
    if content_type is not None:
        return {content_type}

    if _matches_manifest_name(all_files, _COARSE_REACT_MANIFEST) or any(
        path.endswith(_COARSE_REACT_SOURCE_SUFFIXES) for path in paths
    ):
        return {ProjectType.REACT_TS}
    return set()
