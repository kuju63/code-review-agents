import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PRInfoResult } from "../models/pr-info.js";
import type {
  ProjectType as ProjectTypeT,
  ReviewContext,
  ReviewPerspective as ReviewPerspectiveT,
  ReviewResult,
} from "../models/review.js";
import { GithubMcpConnectionError } from "../tools/github-mcp.js";
import type {
  ReviewAgent as ReviewAgentT,
  ReviewerClass,
  ReviewerConfig,
} from "./base-reviewer.js";

const { mockConnect, mockDisconnect, mockCreateGithubMcpClient } = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);
  const mockCreateGithubMcpClient = vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
  }));
  return { mockConnect, mockDisconnect, mockCreateGithubMcpClient };
});

vi.mock("../tools/github-mcp.js", async () => {
  const actual =
    await vi.importActual<typeof import("../tools/github-mcp.js")>("../tools/github-mcp.js");
  return { ...actual, createGithubMcpClient: mockCreateGithubMcpClient };
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makePrInfo(overrides: Partial<PRInfoResult> = {}): PRInfoResult {
  return {
    repositoryInfo: { owner: "octocat", repository: "hello" },
    projectSummary: "A demo repo",
    prInfo: { title: "Add feature", prNumber: 1, body: null, labels: [], fileChanges: [] },
    dependencyFiles: [],
    manifestContents: {},
    ...overrides,
  };
}

function makeReviewerClass(
  ReviewAgentBase: typeof ReviewAgentT,
  opts: {
    reviewerId: string;
    perspective: ReviewPerspectiveT;
    projectTypes: ProjectTypeT[];
    needsGithubMcp?: boolean;
    behavior: (context: ReviewContext, projectType?: ProjectTypeT) => Promise<ReviewResult>;
  },
): ReviewerClass {
  return class extends ReviewAgentBase {
    static readonly reviewerId = opts.reviewerId;
    static readonly perspective = opts.perspective;
    static readonly projectTypes = new Set(opts.projectTypes);

    override get needsGithubMcp(): boolean {
      return opts.needsGithubMcp ?? false;
    }

    review(context: ReviewContext, projectType?: ProjectTypeT): Promise<ReviewResult> {
      return opts.behavior(context, projectType);
    }
  } as unknown as ReviewerClass;
}

async function loadModules() {
  const { ReviewOrchestrator } = await import("./review-orchestrator.js");
  const { registerReviewer, getReviewerClasses } = await import("./registry.js");
  const { ReviewAgent } = await import("./base-reviewer.js");
  const { ProjectType, ReviewPerspective } = await import("../models/review.js");
  const { SharedMcpClient } = await import("../tools/shared-mcp-client.js");
  return {
    ReviewOrchestrator,
    registerReviewer,
    getReviewerClasses,
    ReviewAgent,
    ProjectType,
    ReviewPerspective,
    SharedMcpClient,
  };
}

const CONFIG: ReviewerConfig = { githubToken: "test-token" };

beforeEach(() => {
  vi.resetModules();
  mockConnect.mockClear().mockResolvedValue(undefined);
  mockDisconnect.mockClear().mockResolvedValue(undefined);
  mockCreateGithubMcpClient.mockClear();
});

describe("ReviewOrchestrator.run -- selection and aggregation", () => {
  it("aggregates successful results and stamps the targeted project type", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "fake-technical",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        behavior: async (_context, projectType) => ({
          reviewerId: "fake-technical",
          perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
          projectType: projectType ?? null,
          output: { summary: "ok", findings: [] },
        }),
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    const report = await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);

    expect(report.errors).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.projectType).toBe(ProjectType.enum.REACT_TS);
  });

  it("detects the project type automatically when not given", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "fake-technical",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.ANGULAR],
        behavior: async (_context, projectType) => ({
          reviewerId: "fake-technical",
          perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
          projectType: projectType ?? null,
          output: { summary: "ok", findings: [] },
        }),
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    const report = await orchestrator.run(
      { prInfo: makePrInfo({ dependencyFiles: ["angular.json"] }) },
      undefined,
      [ReviewPerspective.enum.SPEC_CONSISTENCY],
    );

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.projectType).toBe(ProjectType.enum.ANGULAR);
  });

  it("returns an empty report when no reviewer is selected", async () => {
    const { ReviewOrchestrator, ProjectType, ReviewPerspective } = await loadModules();

    const orchestrator = new ReviewOrchestrator(CONFIG);
    const report = await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.SPRING_BOOT, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);

    expect(report).toEqual({ results: [], errors: [] });
    expect(mockCreateGithubMcpClient).not.toHaveBeenCalled();
  });

  it("returns an empty report when no project type is given and none can be detected", async () => {
    const { ReviewOrchestrator } = await loadModules();

    const orchestrator = new ReviewOrchestrator(CONFIG);
    const report = await orchestrator.run({ prInfo: makePrInfo() });

    expect(report).toEqual({ results: [], errors: [] });
    expect(mockCreateGithubMcpClient).not.toHaveBeenCalled();
  });

  it("isolates a failing reviewer as a ReviewError without affecting the others", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "ok-reviewer",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        behavior: async () => ({
          reviewerId: "ok-reviewer",
          perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
          projectType: ProjectType.enum.REACT_TS,
          output: { summary: "ok", findings: [] },
        }),
      }),
    );
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "failing-reviewer",
        perspective: ReviewPerspective.enum.REQUIREMENTS_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        behavior: async () => {
          throw new Error("business failure");
        },
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    const report = await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
      ReviewPerspective.enum.REQUIREMENTS_CONSISTENCY,
    ]);

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.reviewerId).toBe("ok-reviewer");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({
      reviewerId: "failing-reviewer",
      message: "business failure",
    });
  });

  it("stringifies a non-Error rejection as the ReviewError message", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "throws-non-error",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        behavior: async () => {
          throw "plain string failure";
        },
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    const report = await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toBe("plain string failure");
  });

  it("runs reviewers concurrently rather than sequentially", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    for (const id of ["slow-a", "slow-b"]) {
      registerReviewer(
        makeReviewerClass(ReviewAgent, {
          reviewerId: id,
          perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
          projectTypes: [ProjectType.enum.REACT_TS],
          behavior: async () => {
            await sleep(80);
            return {
              reviewerId: id,
              perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
              projectType: ProjectType.enum.REACT_TS,
              output: { summary: "ok", findings: [] },
            };
          },
        }),
      );
    }

    const orchestrator = new ReviewOrchestrator(CONFIG);
    const start = Date.now();
    const report = await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);
    const elapsedMs = Date.now() - start;

    expect(report.results).toHaveLength(2);
    expect(elapsedMs).toBeLessThan(150);
  });

  it("rejects the whole run when a reviewer throws an infra-classified error", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "infra-failing",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        behavior: async () => {
          throw new GithubMcpConnectionError("connection lost");
        },
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    await expect(
      orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
        ReviewPerspective.enum.SPEC_CONSISTENCY,
      ]),
    ).rejects.toBeInstanceOf(GithubMcpConnectionError);
  });

  it("makes the built-in reviewers selectable purely by importing the module", async () => {
    const { getReviewerClasses, ProjectType, ReviewPerspective } = await loadModules();
    const classes = getReviewerClasses(ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.TECHNICAL,
    ]);
    expect(classes.length).toBeGreaterThan(0);
  });
});

describe("ReviewOrchestrator.run -- shared GitHub MCP client", () => {
  it("does not create a shared client when no selected reviewer needs GitHub MCP", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "no-mcp",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        needsGithubMcp: false,
        behavior: async () => ({
          reviewerId: "no-mcp",
          perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
          projectType: ProjectType.enum.REACT_TS,
          output: { summary: "ok", findings: [] },
        }),
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);

    expect(mockCreateGithubMcpClient).not.toHaveBeenCalled();
  });

  it("creates the shared client once and connects it once upfront when a reviewer needs it", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    let observedClient: unknown;
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "mcp-reviewer",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        needsGithubMcp: true,
        behavior: async (context) => {
          observedClient = context.sharedMcpClient;
          return {
            reviewerId: "mcp-reviewer",
            perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
            projectType: ProjectType.enum.REACT_TS,
            output: { summary: "ok", findings: [] },
          };
        },
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);

    expect(mockCreateGithubMcpClient).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(observedClient).toBeDefined();
  });

  it("registers and releases exactly two consumers for one MCP-using reviewer", async () => {
    const {
      ReviewOrchestrator,
      registerReviewer,
      ReviewAgent,
      ProjectType,
      ReviewPerspective,
      SharedMcpClient,
    } = await loadModules();
    const addConsumerSpy = vi.spyOn(SharedMcpClient.prototype, "addConsumer");
    const removeConsumerSpy = vi.spyOn(SharedMcpClient.prototype, "removeConsumer");
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "mcp-reviewer",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        needsGithubMcp: true,
        behavior: async () => ({
          reviewerId: "mcp-reviewer",
          perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
          projectType: ProjectType.enum.REACT_TS,
          output: { summary: "ok", findings: [] },
        }),
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);

    expect(addConsumerSpy).toHaveBeenCalledTimes(2);
    expect(removeConsumerSpy).toHaveBeenCalledTimes(2);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("releases the orchestrator's own consumer and rejects when connect() fails", async () => {
    const {
      ReviewOrchestrator,
      registerReviewer,
      ReviewAgent,
      ProjectType,
      ReviewPerspective,
      SharedMcpClient,
    } = await loadModules();
    const removeConsumerSpy = vi.spyOn(SharedMcpClient.prototype, "removeConsumer");
    mockConnect.mockRejectedValueOnce(new GithubMcpConnectionError("boom"));
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "mcp-reviewer",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        needsGithubMcp: true,
        behavior: async () => ({
          reviewerId: "mcp-reviewer",
          perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
          projectType: ProjectType.enum.REACT_TS,
          output: { summary: "ok", findings: [] },
        }),
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    await expect(
      orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
        ReviewPerspective.enum.SPEC_CONSISTENCY,
      ]),
    ).rejects.toBeInstanceOf(GithubMcpConnectionError);

    expect(removeConsumerSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewOrchestrator.run -- timeout and straggler semantics", () => {
  it("converts a reviewer exceeding the timeout into a ReviewError", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    const deferred = createDeferred<ReviewResult>();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "fast",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        behavior: async () => ({
          reviewerId: "fast",
          perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
          projectType: ProjectType.enum.REACT_TS,
          output: { summary: "ok", findings: [] },
        }),
      }),
    );
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "slow",
        perspective: ReviewPerspective.enum.REQUIREMENTS_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        behavior: () => deferred.promise,
      }),
    );

    const orchestrator = new ReviewOrchestrator({ ...CONFIG, reviewerTimeoutSeconds: 0.03 });
    const report = await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
      ReviewPerspective.enum.REQUIREMENTS_CONSISTENCY,
    ]);

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.reviewerId).toBe("fast");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.reviewerId).toBe("slow");
    expect(report.errors[0]?.message).toBe("Reviewer timed out after 0.03s");

    deferred.resolve({
      reviewerId: "slow",
      perspective: ReviewPerspective.enum.REQUIREMENTS_CONSISTENCY,
      projectType: ProjectType.enum.REACT_TS,
      output: { summary: "late", findings: [] },
    });
  });

  it("waits indefinitely when reviewerTimeoutSeconds is unset", async () => {
    const { ReviewOrchestrator, registerReviewer, ReviewAgent, ProjectType, ReviewPerspective } =
      await loadModules();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "slowish",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        behavior: async () => {
          await sleep(60);
          return {
            reviewerId: "slowish",
            perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
            projectType: ProjectType.enum.REACT_TS,
            output: { summary: "ok", findings: [] },
          };
        },
      }),
    );

    const orchestrator = new ReviewOrchestrator(CONFIG);
    const report = await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);

    expect(report.results).toHaveLength(1);
    expect(report.errors).toHaveLength(0);
  });

  it("does not release a timed-out MCP reviewer's placeholder until it actually finishes", async () => {
    const {
      ReviewOrchestrator,
      registerReviewer,
      ReviewAgent,
      ProjectType,
      ReviewPerspective,
      SharedMcpClient,
    } = await loadModules();
    const removeConsumerSpy = vi.spyOn(SharedMcpClient.prototype, "removeConsumer");
    const deferred = createDeferred<ReviewResult>();
    registerReviewer(
      makeReviewerClass(ReviewAgent, {
        reviewerId: "straggler",
        perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
        projectTypes: [ProjectType.enum.REACT_TS],
        needsGithubMcp: true,
        behavior: () => deferred.promise,
      }),
    );

    const orchestrator = new ReviewOrchestrator({ ...CONFIG, reviewerTimeoutSeconds: 0.02 });
    const report = await orchestrator.run({ prInfo: makePrInfo() }, ProjectType.enum.REACT_TS, [
      ReviewPerspective.enum.SPEC_CONSISTENCY,
    ]);

    expect(report.errors).toHaveLength(1);
    // Only the orchestrator's own setup-time consumer has been released so
    // far; the straggler's placeholder is still outstanding.
    expect(removeConsumerSpy).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).not.toHaveBeenCalled();

    deferred.resolve({
      reviewerId: "straggler",
      perspective: ReviewPerspective.enum.SPEC_CONSISTENCY,
      projectType: ProjectType.enum.REACT_TS,
      output: { summary: "late", findings: [] },
    });

    await vi.waitFor(() => {
      expect(removeConsumerSpy).toHaveBeenCalledTimes(2);
    });
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
