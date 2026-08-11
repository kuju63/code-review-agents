import { describe, expect, it } from "vitest";
import { FullReviewInputSchema } from "./request.model.js";
import { LeadEngineerReportSchema } from "./response.model.js";

describe("Orchestrator models", () => {
  it("parses camelCase input and applies the model default", () => {
    expect(FullReviewInputSchema.parse({ owner: "octo", repo: "repo", prNumber: 42 })).toEqual({
      owner: "octo",
      repo: "repo",
      prNumber: 42,
      modelId: "gpt-4o",
    });
  });

  it("reuses the Lead Engineer report schema", () => {
    expect(LeadEngineerReportSchema.parse({ overallSummary: "Approved" })).toMatchObject({
      overallSummary: "Approved",
    });
  });
});
