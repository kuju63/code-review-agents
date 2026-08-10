import { describe, expect, it } from "vitest";
import {
  acceptedDecisions,
  type LeadEngineerReport,
  PRInfoResultSchema,
  ReviewPriority,
  toMarkdown,
} from "./index.js";

describe("package entry point", () => {
  it("re-exports the models barrel", () => {
    expect(ReviewPriority.enum.HIGH).toBe("high");
    expect(PRInfoResultSchema).toBeDefined();
    expect(acceptedDecisions).toBeTypeOf("function");
    expect(toMarkdown).toBeTypeOf("function");

    const report: LeadEngineerReport = { overallSummary: "ok", decisions: [], reviewerErrors: [] };
    expect(acceptedDecisions(report)).toEqual([]);
  });
});
