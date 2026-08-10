import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PRInfoResult } from "../models/pr-info.js";
import { ProjectType, ReviewPerspective } from "../models/review.js";
import { ReviewAgent, type ReviewerClass } from "./base-reviewer.js";

class FakeReviewer extends ReviewAgent {
  review(): never {
    throw new Error("not implemented in this fake");
  }
}

function makeReviewerClass(overrides: {
  reviewerId: string;
  perspective: ReviewPerspective;
  projectTypes: ProjectType[];
}): ReviewerClass {
  return class extends FakeReviewer {
    static readonly reviewerId = overrides.reviewerId;
    static readonly perspective = overrides.perspective;
    static readonly projectTypes = new Set(overrides.projectTypes);
  };
}

function makePrInfo(overrides: Partial<PRInfoResult> = {}): PRInfoResult {
  return {
    repositoryInfo: { owner: "octocat", repository: "hello" },
    projectSummary: "A demo repo",
    prInfo: {
      title: "Add feature",
      prNumber: 1,
      body: null,
      labels: [],
      fileChanges: [],
    },
    dependencyFiles: [],
    manifestContents: {},
    ...overrides,
  };
}

function withFiles(filePaths: string[], dependencyFiles: string[] = []): PRInfoResult {
  return makePrInfo({
    prInfo: {
      title: "Add feature",
      prNumber: 1,
      body: null,
      labels: [],
      fileChanges: filePaths.map((filePath) => ({ filePath, patch: null })),
    },
    dependencyFiles,
  });
}

describe("registerReviewer / getRegisteredReviewers / getReviewerClasses", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers a reviewer and returns it unchanged", async () => {
    const { registerReviewer } = await import("./registry.js");
    const Reviewer = makeReviewerClass({
      reviewerId: "r",
      perspective: ReviewPerspective.enum.TECHNICAL,
      projectTypes: [ProjectType.enum.REACT_TS],
    });

    const returned = registerReviewer(Reviewer);

    expect(returned).toBe(Reviewer);
  });

  it("selects a registered reviewer by matching project type", async () => {
    const { registerReviewer, getReviewerClasses } = await import("./registry.js");
    const Reviewer = registerReviewer(
      makeReviewerClass({
        reviewerId: "r",
        perspective: ReviewPerspective.enum.TECHNICAL,
        projectTypes: [ProjectType.enum.REACT_TS],
      }),
    );

    expect(getReviewerClasses(ProjectType.enum.REACT_TS)).toEqual([Reviewer]);
  });

  it("excludes a reviewer whose project types do not match", async () => {
    const { registerReviewer, getReviewerClasses } = await import("./registry.js");
    registerReviewer(
      makeReviewerClass({
        reviewerId: "r",
        perspective: ReviewPerspective.enum.TECHNICAL,
        projectTypes: [ProjectType.enum.REACT_TS],
      }),
    );

    expect(getReviewerClasses(ProjectType.enum.SPRING_BOOT)).toEqual([]);
  });

  it("filters by perspective when given", async () => {
    const { registerReviewer, getReviewerClasses } = await import("./registry.js");
    const Technical = registerReviewer(
      makeReviewerClass({
        reviewerId: "technical",
        perspective: ReviewPerspective.enum.TECHNICAL,
        projectTypes: [ProjectType.enum.REACT_TS],
      }),
    );
    registerReviewer(
      makeReviewerClass({
        reviewerId: "security",
        perspective: ReviewPerspective.enum.SECURITY,
        projectTypes: [ProjectType.enum.REACT_TS],
      }),
    );

    expect(
      getReviewerClasses(ProjectType.enum.REACT_TS, [ReviewPerspective.enum.TECHNICAL]),
    ).toEqual([Technical]);
  });

  it("selects a multi-project-type reviewer under each of its project types", async () => {
    const { registerReviewer, getReviewerClasses } = await import("./registry.js");
    const Shared = registerReviewer(
      makeReviewerClass({
        reviewerId: "shared",
        perspective: ReviewPerspective.enum.SECURITY,
        projectTypes: [ProjectType.enum.REACT_TS, ProjectType.enum.NEXTJS],
      }),
    );

    expect(getReviewerClasses(ProjectType.enum.REACT_TS)).toEqual([Shared]);
    expect(getReviewerClasses(ProjectType.enum.NEXTJS)).toEqual([Shared]);
  });

  it("returns a shallow copy from getRegisteredReviewers", async () => {
    const { registerReviewer, getRegisteredReviewers } = await import("./registry.js");
    registerReviewer(
      makeReviewerClass({
        reviewerId: "r",
        perspective: ReviewPerspective.enum.TECHNICAL,
        projectTypes: [ProjectType.enum.REACT_TS],
      }),
    );

    const copy = getRegisteredReviewers();
    copy.push(
      makeReviewerClass({
        reviewerId: "extra",
        perspective: ReviewPerspective.enum.TECHNICAL,
        projectTypes: [ProjectType.enum.REACT_TS],
      }),
    );

    expect(getRegisteredReviewers()).toHaveLength(1);
  });

  describe("metaframework fallback", () => {
    it("falls back to REACT_TS reviewers for NEXTJS", async () => {
      const { registerReviewer, getReviewerClasses } = await import("./registry.js");
      const ReactReviewer = registerReviewer(
        makeReviewerClass({
          reviewerId: "react",
          perspective: ReviewPerspective.enum.TECHNICAL,
          projectTypes: [ProjectType.enum.REACT_TS],
        }),
      );

      expect(getReviewerClasses(ProjectType.enum.NEXTJS)).toEqual([ReactReviewer]);
    });

    it("falls back to VUE reviewers for NUXT", async () => {
      const { registerReviewer, getReviewerClasses } = await import("./registry.js");
      const VueReviewer = registerReviewer(
        makeReviewerClass({
          reviewerId: "vue",
          perspective: ReviewPerspective.enum.TECHNICAL,
          projectTypes: [ProjectType.enum.VUE],
        }),
      );

      expect(getReviewerClasses(ProjectType.enum.NUXT)).toEqual([VueReviewer]);
    });

    it("includes both the metaframework-specific and base-framework reviewers additively", async () => {
      const { registerReviewer, getReviewerClasses } = await import("./registry.js");
      const ReactReviewer = registerReviewer(
        makeReviewerClass({
          reviewerId: "react",
          perspective: ReviewPerspective.enum.TECHNICAL,
          projectTypes: [ProjectType.enum.REACT_TS],
        }),
      );
      const NextReviewer = registerReviewer(
        makeReviewerClass({
          reviewerId: "next",
          perspective: ReviewPerspective.enum.TECHNICAL,
          projectTypes: [ProjectType.enum.NEXTJS],
        }),
      );

      const selected = getReviewerClasses(ProjectType.enum.NEXTJS);
      expect(selected).toEqual(expect.arrayContaining([ReactReviewer, NextReviewer]));
      expect(selected).toHaveLength(2);
    });

    it("does not fall back for an unmapped project type", async () => {
      const { registerReviewer, getReviewerClasses } = await import("./registry.js");
      registerReviewer(
        makeReviewerClass({
          reviewerId: "r",
          perspective: ReviewPerspective.enum.TECHNICAL,
          projectTypes: [ProjectType.enum.REACT_TS],
        }),
      );

      expect(getReviewerClasses(ProjectType.enum.SPRING_BOOT)).toEqual([]);
    });
  });
});

describe("detectProjectTypes", () => {
  it("returns an empty set when nothing matches", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["README.md", "styles.css"]))).toEqual(new Set());
  });

  it("detects REACT_TS from package.json alone", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["package.json"]))).toEqual(
      new Set([ProjectType.enum.REACT_TS]),
    );
  });

  it("detects REACT_TS from a .tsx file alone", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/App.tsx"]))).toEqual(
      new Set([ProjectType.enum.REACT_TS]),
    );
  });

  it("detects REACT_TS from package.json in dependencyFiles", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/other.md"], ["package.json"]))).toEqual(
      new Set([ProjectType.enum.REACT_TS]),
    );
  });

  it("does not match a filename that only ends with package.json as text", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["not-package.json"]))).toEqual(new Set());
  });

  it("matches package.json nested under a workspace path", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["packages/web/package.json"]))).toEqual(
      new Set([ProjectType.enum.REACT_TS]),
    );
  });

  it("detects ANGULAR from angular.json in dependencyFiles", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles([], ["angular.json"]))).toEqual(
      new Set([ProjectType.enum.ANGULAR]),
    );
  });

  it.each([".component.ts", ".service.ts", ".directive.ts", ".pipe.ts"])(
    "detects ANGULAR from a %s naming convention",
    async (suffix) => {
      const { detectProjectTypes } = await import("./registry.js");
      expect(detectProjectTypes(withFiles([`src/app${suffix}`]))).toEqual(
        new Set([ProjectType.enum.ANGULAR]),
      );
    },
  );

  it("Angular suppresses the coarse REACT_TS fallback even with package.json present", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/app.component.ts"], ["package.json"]))).toEqual(
      new Set([ProjectType.enum.ANGULAR]),
    );
  });

  it("detects SVELTE from a .svelte file", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/App.svelte"]))).toEqual(
      new Set([ProjectType.enum.SVELTE]),
    );
  });

  it("detects VUE from a .vue file", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/App.vue"]))).toEqual(new Set([ProjectType.enum.VUE]));
  });

  it("Angular takes priority over Svelte in a mixed-signal repo", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/App.svelte"], ["angular.json"]))).toEqual(
      new Set([ProjectType.enum.ANGULAR]),
    );
  });

  it("Angular takes priority over Vue in a mixed-signal repo", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/App.vue"], ["angular.json"]))).toEqual(
      new Set([ProjectType.enum.ANGULAR]),
    );
  });

  it("Svelte takes priority over Vue in a mixed-signal repo", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/App.vue"], ["svelte.config.js"]))).toEqual(
      new Set([ProjectType.enum.SVELTE]),
    );
  });

  it("Svelte takes priority over the coarse React fallback", async () => {
    const { detectProjectTypes } = await import("./registry.js");
    expect(detectProjectTypes(withFiles(["src/App.svelte"], ["package.json"]))).toEqual(
      new Set([ProjectType.enum.SVELTE]),
    );
  });

  describe("content-based detection (tier 2)", () => {
    it("detects VUE from package.json content without a .vue file", async () => {
      const { detectProjectTypes } = await import("./registry.js");
      const prInfo = makePrInfo({
        manifestContents: {
          "package.json": JSON.stringify({ dependencies: { vue: "^3.0.0" } }),
        },
      });
      expect(detectProjectTypes(prInfo)).toEqual(new Set([ProjectType.enum.VUE]));
    });

    it("Nuxt takes priority over Vue from content when both deps are present", async () => {
      const { detectProjectTypes } = await import("./registry.js");
      const prInfo = makePrInfo({
        manifestContents: {
          "package.json": JSON.stringify({ dependencies: { nuxt: "^3.0.0", vue: "^3.0.0" } }),
        },
      });
      expect(detectProjectTypes(prInfo)).toEqual(new Set([ProjectType.enum.NUXT]));
    });

    it("Next.js takes priority over React from content when both deps are present", async () => {
      const { detectProjectTypes } = await import("./registry.js");
      const prInfo = makePrInfo({
        manifestContents: {
          "package.json": JSON.stringify({ dependencies: { next: "^14.0.0", react: "^19.0.0" } }),
        },
      });
      expect(detectProjectTypes(prInfo)).toEqual(new Set([ProjectType.enum.NEXTJS]));
    });

    it("a tier-1 extension match wins over conflicting tier-2 content", async () => {
      const { detectProjectTypes } = await import("./registry.js");
      const prInfo = makePrInfo({
        prInfo: {
          title: "Add feature",
          prNumber: 1,
          body: null,
          labels: [],
          fileChanges: [{ filePath: "src/App.svelte", patch: null }],
        },
        manifestContents: {
          "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
        },
      });
      expect(detectProjectTypes(prInfo)).toEqual(new Set([ProjectType.enum.SVELTE]));
    });

    it("falls through to the coarse React fallback for an unrecognized package name", async () => {
      const { detectProjectTypes } = await import("./registry.js");
      const prInfo = makePrInfo({
        prInfo: {
          title: "Add feature",
          prNumber: 1,
          body: null,
          labels: [],
          fileChanges: [{ filePath: "package.json", patch: null }],
        },
        manifestContents: {
          "package.json": JSON.stringify({ dependencies: { "some-unrelated-lib": "^1.0.0" } }),
        },
      });
      expect(detectProjectTypes(prInfo)).toEqual(new Set([ProjectType.enum.REACT_TS]));
    });
  });
});
