import { describe, expect, it } from "vitest";
import { FullReviewInputSchema } from "./request.model.js";
import { LeadEngineerReportSchema } from "./response.model.js";

describe("Orchestrator models", () => {
  it("parses and trims camelCase input", () => {
    expect(
      FullReviewInputSchema.parse({
        owner: " octo ",
        repo: " repo ",
        prNumber: 42,
        modelId: " configured-model ",
      }),
    ).toEqual({
      owner: "octo",
      repo: "repo",
      prNumber: 42,
      modelId: "configured-model",
    });
  });

  it.each([
    { owner: "", repo: "repo", prNumber: 1 },
    { owner: "   ", repo: "repo", prNumber: 1 },
    { owner: "octo", repo: "", prNumber: 1 },
    { owner: "octo", repo: "   ", prNumber: 1 },
    { owner: "octo", repo: "repo", prNumber: 0 },
    { owner: "octo", repo: "repo", prNumber: -1 },
    { owner: "octo", repo: "repo", prNumber: 1, modelId: "   " },
  ])("rejects invalid input %#", (input) => {
    expect(FullReviewInputSchema.safeParse(input).success).toBe(false);
  });

  it("reuses the Lead Engineer report schema", () => {
    expect(LeadEngineerReportSchema.parse({ overallSummary: "Approved" })).toMatchObject({
      overallSummary: "Approved",
    });
  });
});
