import { describe, expect, it } from "vitest";
import { PRInfoResultSchema } from "./pr-info.js";
import {
  ProjectType,
  type ReviewContext,
  ReviewErrorSchema,
  ReviewFindingSchema,
  ReviewOutputSchema,
  ReviewPerspective,
  ReviewPriority,
  ReviewReportSchema,
  ReviewResultSchema,
} from "./review.js";

const makePrInfo = () =>
  PRInfoResultSchema.parse({
    repositoryInfo: { owner: "octocat", repository: "hello" },
    projectSummary: "A sample project.",
    prInfo: { title: "Fix", prNumber: 1 },
    dependencyFiles: ["package.json"],
  });

describe("enums", () => {
  it("has the expected ProjectType values", () => {
    expect(ProjectType.enum.REACT_TS).toBe("react_ts");
    expect(ProjectType.enum.ANGULAR).toBe("angular");
    for (const name of ["SPRING_BOOT", "NEXTJS", "NUXT", "WASM"] as const) {
      expect(ProjectType.enum[name]).toBeDefined();
    }
  });

  it("has the expected ReviewPerspective values", () => {
    expect(ReviewPerspective.enum.TECHNICAL).toBe("technical");
    expect(ReviewPerspective.enum.SECURITY).toBe("security");
    for (const name of ["SPEC_CONSISTENCY", "REQUIREMENTS_CONSISTENCY"] as const) {
      expect(ReviewPerspective.enum[name]).toBeDefined();
    }
  });

  it("has the expected ReviewPriority values", () => {
    expect(new Set(ReviewPriority.options)).toEqual(new Set(["critical", "high", "medium", "low"]));
  });
});

describe("ReviewFindingSchema", () => {
  it("accepts a minimal finding", () => {
    const finding = ReviewFindingSchema.parse({
      comment: "Avoid index as key",
      priority: "medium",
    });
    expect(finding.comment).toBe("Avoid index as key");
    expect(finding.priority).toBe("medium");
    expect(finding.filePath).toBeNull();
    expect(finding.line).toBeNull();
    expect(finding.context).toBeNull();
    expect(finding.proposedFix).toBeNull();
  });

  it("accepts a full finding", () => {
    const finding = ReviewFindingSchema.parse({
      filePath: "src/App.tsx",
      line: 42,
      comment: "useEffect missing dependency",
      context: "Stale closure risk",
      proposedFix: "Add `count` to the dependency array",
      priority: "high",
    });
    expect(finding.filePath).toBe("src/App.tsx");
    expect(finding.line).toBe(42);
    expect(finding.priority).toBe("high");
  });

  it("requires priority", () => {
    expect(() => ReviewFindingSchema.parse({ comment: "missing priority" })).toThrow();
  });

  it("rejects an out-of-vocabulary priority", () => {
    expect(() => ReviewFindingSchema.parse({ comment: "x", priority: "urgent" })).toThrow();
  });
});

describe("ReviewOutputSchema", () => {
  it("defaults findings to an empty array", () => {
    const output = ReviewOutputSchema.parse({ summary: "No issues found." });
    expect(output.findings).toEqual([]);
  });

  it("holds findings", () => {
    const output = ReviewOutputSchema.parse({
      summary: "One issue.",
      findings: [{ comment: "x", priority: "low" }],
    });
    expect(output.findings).toHaveLength(1);
  });
});

describe("ReviewContext", () => {
  it("wraps pr info", () => {
    const ctx: ReviewContext = { prInfo: makePrInfo() };
    expect(ctx.prInfo.repositoryInfo.owner).toBe("octocat");
  });

  it("defaults sharedMcpClient to undefined", () => {
    const ctx: ReviewContext = { prInfo: makePrInfo() };
    expect(ctx.sharedMcpClient).toBeUndefined();
  });
});

describe("ReviewResultSchema", () => {
  it("carries metadata and output", () => {
    const result = ReviewResultSchema.parse({
      reviewerId: "react-technical",
      perspective: "technical",
      projectType: "react_ts",
      output: { summary: "ok" },
    });
    expect(result.reviewerId).toBe("react-technical");
    expect(result.perspective).toBe("technical");
    expect(result.projectType).toBe("react_ts");
  });

  it("defaults projectType to null", () => {
    const result = ReviewResultSchema.parse({
      reviewerId: "r",
      perspective: "security",
      output: { summary: "ok" },
    });
    expect(result.projectType).toBeNull();
  });
});

describe("ReviewReportSchema", () => {
  it("defaults to empty results and errors", () => {
    const report = ReviewReportSchema.parse({});
    expect(report.results).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it("aggregates results and errors", () => {
    const report = ReviewReportSchema.parse({
      results: [
        {
          reviewerId: "r",
          perspective: "technical",
          output: { summary: "ok" },
        },
      ],
      errors: [
        ReviewErrorSchema.parse({
          reviewerId: "bad",
          perspective: "security",
          message: "boom",
        }),
      ],
    });
    expect(report.results).toHaveLength(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toBe("boom");
  });
});
