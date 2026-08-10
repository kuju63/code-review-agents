import { parse as parseYaml } from "yaml";
import { ProjectType } from "../models/review.js";

const SVELTE_SCOPE_PREFIX = "@sveltejs/";

/**
 * Ordered by specificity: a metaframework's own package name is checked
 * before its base framework's, and Angular/Svelte are checked before the
 * Vue/React families so a project depending on multiple of these (rare, but
 * possible during a migration) resolves the same way registry.ts's
 * extension-based rules already prioritize Angular > Svelte > Vue > React.
 */
const PACKAGE_PROJECT_TYPE_PRIORITY: ReadonlyArray<readonly [ProjectType, string]> = [
  [ProjectType.enum.ANGULAR, "@angular/core"],
  [ProjectType.enum.SVELTE, "svelte"],
  [ProjectType.enum.NUXT, "nuxt"],
  [ProjectType.enum.VUE, "vue"],
  [ProjectType.enum.NEXTJS, "next"],
  [ProjectType.enum.REACT_TS, "react"],
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectFields(scope: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"] as const) {
    const value = scope[field];
    if (isPlainRecord(value)) {
      for (const key of Object.keys(value)) {
        names.add(key);
      }
    }
  }
  return names;
}

/** Extract direct dependency names from a `package.json` body. */
export function extractDirectDependenciesFromPackageJson(content: string): Set<string> {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return new Set();
  }
  return isPlainRecord(data) ? collectFields(data) : new Set();
}

/**
 * Extract the root project's direct dependency names from `package-lock.json`.
 *
 * Only lockfileVersion 2/3's `packages[""]` root entry is read, since its
 * `dependencies`/`devDependencies` mirror `package.json` without pulling in
 * the transitive tree encoded elsewhere in the file.
 */
export function extractDirectDependenciesFromPackageLock(content: string): Set<string> {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return new Set();
  }
  if (!isPlainRecord(data)) {
    return new Set();
  }
  const packages = data.packages;
  const rootEntry = isPlainRecord(packages) ? packages[""] : undefined;
  return isPlainRecord(rootEntry) ? collectFields(rootEntry) : new Set();
}

/**
 * Extract the root project's direct dependency names from `pnpm-lock.yaml`.
 *
 * Reads `importers["."]` (workspace-aware pnpm lockfile format) when
 * present, falling back to top-level `dependencies`/`devDependencies` for a
 * non-workspace pnpm project.
 */
export function extractDirectDependenciesFromPnpmLock(content: string): Set<string> {
  let data: unknown;
  try {
    data = parseYaml(content);
  } catch {
    return new Set();
  }
  if (!isPlainRecord(data)) {
    return new Set();
  }
  const importers = data.importers;
  const scope = isPlainRecord(importers) ? importers["."] : data;
  return isPlainRecord(scope) ? collectFields(scope) : new Set();
}

/** Resolve a single {@link ProjectType} from a set of direct dependency names. */
export function detectProjectTypeFromPackages(packageNames: Set<string>): ProjectType | undefined {
  for (const [projectType, packageName] of PACKAGE_PROJECT_TYPE_PRIORITY) {
    if (projectType === ProjectType.enum.SVELTE) {
      const hasScopedSvelte = [...packageNames].some((name) =>
        name.startsWith(SVELTE_SCOPE_PREFIX),
      );
      if (packageNames.has(packageName) || hasScopedSvelte) {
        return projectType;
      }
      continue;
    }
    if (packageNames.has(packageName)) {
      return projectType;
    }
  }
  return undefined;
}

/**
 * Aggregate direct dependency names across all collected manifests.
 *
 * `package.json` is authoritative: when at least one `package.json` (root or
 * a resolved workspace package) parses to a non-empty dependency set, lock
 * files are not consulted. Lock files are read only as a fallback when no
 * `package.json` content yielded any dependency names, since lock files mix
 * in transitive dependencies for older/simpler formats and package.json is
 * the more precise signal.
 */
export function collectDirectPackageNames(manifestContents: Record<string, string>): Set<string> {
  const packageJsonNames = new Set<string>();
  for (const [path, content] of Object.entries(manifestContents)) {
    if (path.endsWith("package.json")) {
      for (const name of extractDirectDependenciesFromPackageJson(content)) {
        packageJsonNames.add(name);
      }
    }
  }
  if (packageJsonNames.size > 0) {
    return packageJsonNames;
  }

  const lockNames = new Set<string>();
  for (const [path, content] of Object.entries(manifestContents)) {
    if (path.endsWith("package-lock.json")) {
      for (const name of extractDirectDependenciesFromPackageLock(content)) {
        lockNames.add(name);
      }
    } else if (path.endsWith("pnpm-lock.yaml")) {
      for (const name of extractDirectDependenciesFromPnpmLock(content)) {
        lockNames.add(name);
      }
    }
  }
  return lockNames;
}
