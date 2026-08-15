import { describe, expect, it } from "vitest";
import { ReviewerSendTaskRequestSchema, ReviewerSkillInputSchema } from "./request.model.js";
import { ReviewerGetTaskResponseSchema, ReviewResultSchema } from "./response.model.js";

describe("reviewer models", () => {
  const prInfo = {
    repositoryInfo: { owner: "octo", repository: "repo" },
    projectSummary: "React",
    prInfo: { title: "Change", prNumber: 42 },
  };

  it("parses the shared camelCase reviewer input", () => {
    expect(ReviewerSkillInputSchema.parse({ prInfo })).toMatchObject({
      prInfo: { prInfo: { prNumber: 42 } },
    });
    expect(ReviewerSkillInputSchema.parse({ prInfo })).not.toHaveProperty("modelId");
  });

  it("exposes shared endpoint contracts for all reviewers", () => {
    expect(
      ReviewerSendTaskRequestSchema.parse({
        headers: { authorization: "Bearer token" },
        body: { message: { role: "user", parts: [] } },
      }),
    ).toMatchObject({ headers: { authorization: "Bearer token" } });
    expect(
      ReviewerGetTaskResponseSchema.parse({
        status: 404,
        body: { detail: "Task not found" },
      }),
    ).toEqual({ status: 404, body: { detail: "Task not found" } });
  });

  it("reuses the review result schema", () => {
    expect(
      ReviewResultSchema.parse({
        reviewerId: "react-reviewer",
        perspective: "technical",
        output: { summary: "Looks good" },
      }),
    ).toMatchObject({ reviewerId: "react-reviewer", projectType: null });
  });
});
