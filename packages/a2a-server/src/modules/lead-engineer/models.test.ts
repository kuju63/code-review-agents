import { describe, expect, it } from "vitest";
import { LeadEngineerSkillInputSchema } from "./request.model.js";
import { LeadEngineerReportSchema } from "./response.model.js";

describe("Lead Engineer models", () => {
  it("parses camelCase input and applies defaults", () => {
    expect(LeadEngineerSkillInputSchema.parse({ reviewReport: {} })).toEqual({
      reviewReport: { results: [], errors: [] },
      modelId: "gpt-4o",
    });
  });

  it("reuses the Lead Engineer report schema", () => {
    expect(LeadEngineerReportSchema.parse({ overallSummary: "Approved" })).toEqual({
      overallSummary: "Approved",
      decisions: [],
      reviewerErrors: [],
    });
  });
});
