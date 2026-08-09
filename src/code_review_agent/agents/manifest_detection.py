"""Content-based project-type detection from JS/TS dependency manifests.

Complements :mod:`registry`'s file-extension/manifest-name detection rules
(Issue #230). Those rules cover stacks with an unambiguous file pattern
(Angular's ``.component.ts``, Svelte's ``.svelte``, Vue's ``.vue``) but cannot
distinguish a metaframework (Next.js, Nuxt) from its base framework, nor
detect a stack whose PR touches neither a distinguishing file nor a manifest
filename. This module resolves that gap by inspecting the *direct*
dependencies declared in ``package.json`` (or, when unavailable, a lock
file's root/importer entry) rather than transitive dependencies, since almost
every non-trivial JS project transitively depends on packages like ``react``
through its build tooling.
"""

import json
from typing import Any

import yaml

from ..models.review import ProjectType

_SVELTE_SCOPE_PREFIX = "@sveltejs/"

# Ordered by specificity: a metaframework's own package name is checked
# before its base framework's, and Angular/Svelte are checked before the
# Vue/React families so a project depending on multiple of these (rare, but
# possible during a migration) resolves the same way registry.py's
# extension-based rules already prioritize Angular > Svelte > Vue > React.
_PACKAGE_PROJECT_TYPE_PRIORITY: tuple[tuple[ProjectType, str], ...] = (
    (ProjectType.ANGULAR, "@angular/core"),
    (ProjectType.SVELTE, "svelte"),
    (ProjectType.NUXT, "nuxt"),
    (ProjectType.VUE, "vue"),
    (ProjectType.NEXTJS, "next"),
    (ProjectType.REACT_TS, "react"),
)


def extract_direct_dependencies_from_package_json(content: str) -> set[str]:
    """Extract direct dependency names from a ``package.json`` body.

    Args:
        content: Raw ``package.json`` file text.

    Returns:
        The union of ``dependencies`` and ``devDependencies`` keys, or an
        empty set if ``content`` is not valid JSON or has neither field.
    """
    try:
        data = json.loads(content)
    except (ValueError, TypeError):
        return set()
    if not isinstance(data, dict):
        return set()
    names: set[str] = set()
    for field in ("dependencies", "devDependencies"):
        value = data.get(field)
        if isinstance(value, dict):
            names.update(value.keys())
    return names


def extract_direct_dependencies_from_package_lock(content: str) -> set[str]:
    """Extract the root project's direct dependency names from ``package-lock.json``.

    Only lockfileVersion 2/3's ``packages[""]`` root entry is read, since its
    ``dependencies``/``devDependencies`` mirror ``package.json`` without
    pulling in the transitive tree encoded elsewhere in the file.

    Args:
        content: Raw ``package-lock.json`` file text.

    Returns:
        The root entry's direct dependency names, or an empty set if
        ``content`` is not valid JSON or has no ``packages[""]`` entry.
    """
    try:
        data = json.loads(content)
    except (ValueError, TypeError):
        return set()
    if not isinstance(data, dict):
        return set()
    packages = data.get("packages")
    root_entry = packages.get("") if isinstance(packages, dict) else None
    if not isinstance(root_entry, dict):
        return set()
    names: set[str] = set()
    for field in ("dependencies", "devDependencies"):
        value = root_entry.get(field)
        if isinstance(value, dict):
            names.update(value.keys())
    return names


def extract_direct_dependencies_from_pnpm_lock(content: str) -> set[str]:
    """Extract the root project's direct dependency names from ``pnpm-lock.yaml``.

    Reads ``importers["."]`` (workspace-aware pnpm lockfile format) when
    present, falling back to top-level ``dependencies``/``devDependencies``
    for a non-workspace pnpm project.

    Args:
        content: Raw ``pnpm-lock.yaml`` file text.

    Returns:
        The root project's direct dependency names, or an empty set if
        ``content`` is not valid YAML or has neither shape.
    """
    try:
        data = yaml.safe_load(content)
    except yaml.YAMLError:
        return set()
    if not isinstance(data, dict):
        return set()
    importers = data.get("importers")
    scope: Any = importers.get(".") if isinstance(importers, dict) else data
    if not isinstance(scope, dict):
        return set()
    names: set[str] = set()
    for field in ("dependencies", "devDependencies"):
        value = scope.get(field)
        if isinstance(value, dict):
            names.update(value.keys())
    return names


def detect_project_type_from_packages(package_names: set[str]) -> ProjectType | None:
    """Resolve a single :class:`ProjectType` from a set of direct dependency names.

    Args:
        package_names: Direct dependency names collected from one or more
            manifests (see :func:`collect_direct_package_names`).

    Returns:
        The highest-priority matching project type, or ``None`` if no known
        framework/metaframework package is present.
    """
    for project_type, package_name in _PACKAGE_PROJECT_TYPE_PRIORITY:
        if project_type is ProjectType.SVELTE:
            if package_name in package_names or any(
                name.startswith(_SVELTE_SCOPE_PREFIX) for name in package_names
            ):
                return project_type
            continue
        if package_name in package_names:
            return project_type
    return None


def collect_direct_package_names(manifest_contents: dict[str, str]) -> set[str]:
    """Aggregate direct dependency names across all collected manifests.

    ``package.json`` is authoritative: when at least one ``package.json``
    (root or a resolved workspace package) parses to a non-empty dependency
    set, lock files are not consulted. Lock files are read only as a
    fallback when no ``package.json`` content yielded any dependency names
    (for example when the fetch failed but a lock file was still listed),
    since lock files mix in transitive dependencies for older/simpler
    formats and package.json is the more precise signal.

    Args:
        manifest_contents: Mapping of repository-relative manifest path to
            its raw text content, as collected by
            :class:`~code_review_agent.agents.pr_info_collector.PRInfoCollector`.

    Returns:
        The union of direct dependency names found, or an empty set if no
        manifest yielded any.
    """
    package_json_names: set[str] = set()
    for path, content in manifest_contents.items():
        if path.endswith("package.json"):
            package_json_names.update(
                extract_direct_dependencies_from_package_json(content)
            )
    if package_json_names:
        return package_json_names

    lock_names: set[str] = set()
    for path, content in manifest_contents.items():
        if path.endswith("package-lock.json"):
            lock_names.update(extract_direct_dependencies_from_package_lock(content))
        elif path.endswith("pnpm-lock.yaml"):
            lock_names.update(extract_direct_dependencies_from_pnpm_lock(content))
    return lock_names
