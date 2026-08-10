import { describe, expect, it } from "vitest";
import { ProjectType } from "../models/review.js";
import {
  collectDirectPackageNames,
  detectProjectTypeFromPackages,
  extractDirectDependenciesFromPackageJson,
  extractDirectDependenciesFromPackageLock,
  extractDirectDependenciesFromPnpmLock,
} from "./manifest-detection.js";

describe("extractDirectDependenciesFromPackageJson", () => {
  it("merges dependencies and devDependencies", () => {
    const content = JSON.stringify({
      dependencies: { react: "^19.0.0" },
      devDependencies: { typescript: "^5.9.0" },
    });

    expect(extractDirectDependenciesFromPackageJson(content)).toEqual(
      new Set(["react", "typescript"]),
    );
  });

  it("returns an empty set for invalid JSON", () => {
    expect(extractDirectDependenciesFromPackageJson("{not json")).toEqual(new Set());
  });

  it("returns an empty set when the parsed JSON is not an object", () => {
    expect(extractDirectDependenciesFromPackageJson("[1, 2, 3]")).toEqual(new Set());
    expect(extractDirectDependenciesFromPackageJson('"just a string"')).toEqual(new Set());
  });

  it("returns an empty set when neither field is present", () => {
    expect(extractDirectDependenciesFromPackageJson("{}")).toEqual(new Set());
  });
});

describe("extractDirectDependenciesFromPackageLock", () => {
  it('reads the root packages[""] entry', () => {
    const content = JSON.stringify({
      packages: {
        "": { dependencies: { react: "^19.0.0" }, devDependencies: { vitest: "^3.0.0" } },
        "node_modules/react": { version: "19.0.0" },
      },
    });

    expect(extractDirectDependenciesFromPackageLock(content)).toEqual(new Set(["react", "vitest"]));
  });

  it("returns an empty set when there is no root entry", () => {
    expect(extractDirectDependenciesFromPackageLock(JSON.stringify({ packages: {} }))).toEqual(
      new Set(),
    );
  });

  it("returns an empty set for invalid JSON", () => {
    expect(extractDirectDependenciesFromPackageLock("not json")).toEqual(new Set());
  });
});

describe("extractDirectDependenciesFromPnpmLock", () => {
  it("reads importers['.'] for a workspace-aware lockfile", () => {
    const content = `
importers:
  .:
    dependencies:
      vue: {}
    devDependencies:
      typescript: {}
`;

    expect(extractDirectDependenciesFromPnpmLock(content)).toEqual(new Set(["vue", "typescript"]));
  });

  it("falls back to top-level dependencies for a non-workspace lockfile", () => {
    const content = `
dependencies:
  svelte: {}
`;

    expect(extractDirectDependenciesFromPnpmLock(content)).toEqual(new Set(["svelte"]));
  });

  it("returns an empty set for invalid YAML", () => {
    expect(extractDirectDependenciesFromPnpmLock(":\n  - invalid: [")).toEqual(new Set());
  });

  it("returns an empty set when importers exists but '.' is missing", () => {
    const content = `
importers:
  packages/foo:
    dependencies:
      react: {}
`;

    expect(extractDirectDependenciesFromPnpmLock(content)).toEqual(new Set());
  });
});

describe("detectProjectTypeFromPackages", () => {
  it("prioritizes Angular over other matches", () => {
    expect(
      detectProjectTypeFromPackages(new Set(["@angular/core", "svelte", "vue", "react"])),
    ).toBe(ProjectType.enum.ANGULAR);
  });

  it("detects Svelte via a scoped @sveltejs/ package without the bare 'svelte' package", () => {
    expect(detectProjectTypeFromPackages(new Set(["@sveltejs/kit"]))).toBe(ProjectType.enum.SVELTE);
  });

  it("detects Nuxt before Vue and Next.js before React", () => {
    expect(detectProjectTypeFromPackages(new Set(["nuxt", "vue"]))).toBe(ProjectType.enum.NUXT);
    expect(detectProjectTypeFromPackages(new Set(["next", "react"]))).toBe(ProjectType.enum.NEXTJS);
  });

  it("returns undefined when no known framework package is present", () => {
    expect(detectProjectTypeFromPackages(new Set(["lodash"]))).toBeUndefined();
  });
});

describe("collectDirectPackageNames", () => {
  it("treats package.json as authoritative over lock files when non-empty", () => {
    const manifestContents = {
      "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "package-lock.json": JSON.stringify({
        packages: { "": { dependencies: { vue: "^3.0.0" } } },
      }),
    };

    expect(collectDirectPackageNames(manifestContents)).toEqual(new Set(["react"]));
  });

  it("falls back to lock files when no package.json yields any dependency names", () => {
    const manifestContents = {
      "package.json": "{}",
      "package-lock.json": JSON.stringify({
        packages: { "": { dependencies: { vue: "^3.0.0" } } },
      }),
      "pnpm-lock.yaml": "dependencies:\n  svelte: {}\n",
    };

    expect(collectDirectPackageNames(manifestContents)).toEqual(new Set(["vue", "svelte"]));
  });

  it("merges package.json names across multiple workspace packages", () => {
    const manifestContents = {
      "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "packages/app/package.json": JSON.stringify({ dependencies: { vue: "^3.0.0" } }),
    };

    expect(collectDirectPackageNames(manifestContents)).toEqual(new Set(["react", "vue"]));
  });

  it("returns an empty set when nothing is present", () => {
    expect(collectDirectPackageNames({})).toEqual(new Set());
  });
});
