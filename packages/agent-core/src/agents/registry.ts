/**
 * Reviewer registry and project-type detection.
 *
 * This module is the extension point of the parallel review stage.
 * Reviewers register themselves with `registerReviewer`; the orchestrator
 * asks `getReviewerClasses` which reviewers apply to a given project type
 * and optional set of perspectives. Adding a new project type or
 * perspective is a matter of writing a reviewer class and registering it --
 * no change to the orchestrator or this module's selection logic is
 * required.
 */

import type { PRInfoResult } from "../models/pr-info.js";
import { ProjectType, type ReviewPerspective } from "../models/review.js";
import type { ReviewerClass } from "./base-reviewer.js";
import { collectDirectPackageNames, detectProjectTypeFromPackages } from "./manifest-detection.js";

const registry: ReviewerClass[] = [];

// Next.js and Nuxt share their base framework's file extensions entirely, so
// they carry no dedicated reviewer (see manifest-detection.ts). A PR
// detected as one of these metaframeworks still gets reviewed by its base
// framework's registered reviewers, so "no NextReviewer yet" never means "no
// review at all" -- see getReviewerClasses.
const METAFRAMEWORK_BASE: ReadonlyMap<ProjectType, ProjectType> = new Map([
  [ProjectType.enum.NEXTJS, ProjectType.enum.REACT_TS],
  [ProjectType.enum.NUXT, ProjectType.enum.VUE],
]);

/**
 * A single project-type detection rule.
 *
 * Rules are evaluated in array order, so earlier (more specific) rules take
 * priority over later (coarser) ones in mixed-signal repositories. A rule
 * matches when any of its manifest names or source suffixes is present.
 */
interface DetectionRule {
  projectType: ProjectType;
  /**
   * Manifest basenames matched against repository-level files (PR-changed
   * files plus `dependencyFiles`). Matching is exact on the basename, so
   * `not-package.json` does not match `package.json`.
   */
  manifests: readonly string[];
  /**
   * Path suffixes matched against PR-changed files only, so a
   * repository-wide dependency listing does not falsely qualify a stack the
   * PR did not actually touch.
   */
  sourceSuffixes: readonly string[];
}

/** Return `true` when `path`'s basename is exactly `name`. */
function matchesManifest(path: string, name: string): boolean {
  return path === name || path.endsWith(`/${name}`);
}

function matchesManifestName(paths: ReadonlySet<string>, name: string): boolean {
  return [...paths].some((path) => matchesManifest(path, name));
}

const ANGULAR_SOURCE_SUFFIXES = [
  ".component.ts",
  ".service.ts",
  ".directive.ts",
  ".pipe.ts",
] as const;

// Ordered by specificity: framework rules with an unambiguous file pattern
// precede the content-based tier and the coarse React/TypeScript fallback
// (see detectProjectTypes), so a JS/TS or package.json signal does not
// misclassify an Angular, Svelte, or Vue project as React.
const DETECTION_RULES: readonly DetectionRule[] = [
  {
    projectType: ProjectType.enum.ANGULAR,
    manifests: ["angular.json"],
    sourceSuffixes: ANGULAR_SOURCE_SUFFIXES,
  },
  {
    projectType: ProjectType.enum.SVELTE,
    manifests: ["svelte.config.js", "svelte.config.ts"],
    sourceSuffixes: [".svelte"],
  },
  {
    projectType: ProjectType.enum.VUE,
    manifests: ["vue.config.js", "vue.config.ts"],
    sourceSuffixes: [".vue"],
  },
];

// The coarse last-resort fallback (tier 3 of detectProjectTypes): a PR
// touching package.json or generic TS/JS/JSX files, with no signal from the
// rules above or from manifest content, is assumed to be React/TypeScript.
const COARSE_REACT_MANIFEST = "package.json";
const COARSE_REACT_SOURCE_SUFFIXES = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Register a reviewer class so the orchestrator can discover it.
 *
 * Called as a plain function at the bottom of each reviewer module (see
 * spec doc section 4.4) rather than as a decorator; the concrete class type
 * is preserved so decorated reviewers keep their own static properties.
 */
export function registerReviewer<T extends ReviewerClass>(cls: T): T {
  registry.push(cls);
  return cls;
}

/** Return a copy of all registered reviewer classes. */
export function getRegisteredReviewers(): ReviewerClass[] {
  return [...registry];
}

/**
 * Select reviewer classes applicable to a project type.
 *
 * When `projectType` is a metaframework with no dedicated reviewer
 * (`NEXTJS`, `NUXT`; see {@link METAFRAMEWORK_BASE}), reviewers registered
 * for its base framework (`REACT_TS`, `VUE`) are included too, so detecting
 * the metaframework never yields zero reviewers. When `perspectives` is
 * given, the selection is additionally restricted to those perspectives.
 */
export function getReviewerClasses(
  projectType: ProjectType,
  perspectives?: Iterable<ReviewPerspective>,
): ReviewerClass[] {
  const allowed = perspectives ? new Set(perspectives) : undefined;
  const matchingTypes = new Set<ProjectType>([projectType]);
  const baseType = METAFRAMEWORK_BASE.get(projectType);
  if (baseType !== undefined) {
    matchingTypes.add(baseType);
  }

  const selected: ReviewerClass[] = [];
  for (const cls of registry) {
    const intersects = [...cls.projectTypes].some((pt) => matchingTypes.has(pt));
    if (!intersects) {
      continue;
    }
    if (allowed && !allowed.has(cls.perspective)) {
      continue;
    }
    selected.push(cls);
  }
  return selected;
}

/**
 * Infer applicable project types from collected PR information.
 *
 * Used as the default reviewer selection when the caller does not specify a
 * project type explicitly. Detection runs in three tiers, each returning
 * immediately on a match:
 *
 * 1. {@link DETECTION_RULES} -- file-extension/manifest-name rules for
 *    stacks with an unambiguous pattern (Angular, Svelte, Vue). Evaluated in
 *    order; the first match wins, so more specific framework rules precede
 *    the coarse React/TypeScript rule below.
 * 2. Content-based detection via `collectDirectPackageNames` and
 *    `detectProjectTypeFromPackages`, using `prInfo.manifestContents`
 *    (`package.json`/lock-file text). This resolves what tier 1 cannot:
 *    metaframeworks (Next.js, Nuxt) that share their base framework's
 *    extensions entirely, and any stack whose PR touches neither a
 *    distinguishing file nor a manifest filename (only its content reveals
 *    the framework).
 * 3. The coarse fallback: a PR touching `package.json` or generic
 *    TS/JS/JSX changes, with no signal from tiers 1-2, is assumed to be
 *    React/TypeScript.
 *
 * Detecting more than one project type for a single PR is not supported:
 * exactly one type is returned whenever any tier matches, otherwise an
 * empty set.
 */
export function detectProjectTypes(prInfo: PRInfoResult): Set<ProjectType> {
  const paths = prInfo.prInfo.fileChanges.map((change) => change.filePath);
  const allFiles = new Set([...prInfo.dependencyFiles, ...paths]);

  for (const rule of DETECTION_RULES) {
    const hasManifest = rule.manifests.some((name) => matchesManifestName(allFiles, name));
    const hasSource = paths.some((path) =>
      rule.sourceSuffixes.some((suffix) => path.endsWith(suffix)),
    );
    if (hasManifest || hasSource) {
      return new Set([rule.projectType]);
    }
  }

  const packageNames = collectDirectPackageNames(prInfo.manifestContents);
  const contentType = detectProjectTypeFromPackages(packageNames);
  if (contentType !== undefined) {
    return new Set([contentType]);
  }

  if (
    matchesManifestName(allFiles, COARSE_REACT_MANIFEST) ||
    paths.some((path) => COARSE_REACT_SOURCE_SUFFIXES.some((suffix) => path.endsWith(suffix)))
  ) {
    return new Set([ProjectType.enum.REACT_TS]);
  }
  return new Set();
}
