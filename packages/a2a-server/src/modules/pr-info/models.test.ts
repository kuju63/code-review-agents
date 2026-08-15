import { describe, expect, it } from "vitest";
import {
  CollectPrInfoInputSchema,
  PrInfoGetTaskRequestSchema,
  PrInfoSendTaskRequestSchema,
} from "./request.model.js";
import {
  PRInfoResultSchema,
  PrInfoAgentCardResponseSchema,
  PrInfoSendTaskResponseSchema,
} from "./response.model.js";

describe("PR Info models", () => {
  it("parses and trims camelCase input", () => {
    expect(
      CollectPrInfoInputSchema.parse({ owner: " octo ", repo: " repo ", prNumber: 42 }),
    ).toEqual({
      owner: "octo",
      repo: "repo",
      prNumber: 42,
    });
  });

  it.each([
    { owner: "", repo: "repo", prNumber: 1 },
    { owner: "   ", repo: "repo", prNumber: 1 },
    { owner: "octo", repo: "", prNumber: 1 },
    { owner: "octo", repo: "   ", prNumber: 1 },
    { owner: "octo", repo: "repo", prNumber: 0 },
    { owner: "octo", repo: "repo", prNumber: -1 },
  ])("rejects invalid PR identifiers %#", (input) => {
    expect(CollectPrInfoInputSchema.safeParse(input).success).toBe(false);
  });

  it("exposes the three endpoint contracts", () => {
    expect(
      PrInfoSendTaskRequestSchema.parse({
        headers: { authorization: "Bearer token" },
        body: { message: { role: "user", parts: [] } },
      }),
    ).toMatchObject({ headers: { authorization: "Bearer token" } });
    expect(
      PrInfoGetTaskRequestSchema.parse({
        headers: { authorization: "Bearer token" },
        params: { taskId: "task-1" },
      }),
    ).toEqual({
      headers: { authorization: "Bearer token" },
      params: { taskId: "task-1" },
    });
    expect(
      PrInfoAgentCardResponseSchema.parse({
        status: 200,
        body: {
          name: "PR Info Collector",
          description: "Collects PR information",
          url: "http://localhost/pr-info-collector",
          skills: [],
        },
      }),
    ).toMatchObject({ status: 200, body: { name: "PR Info Collector" } });
    expect(
      PrInfoSendTaskResponseSchema.parse({
        status: 202,
        body: { task: { id: "task-1", status: "submitted" } },
      }),
    ).toMatchObject({ status: 202, body: { task: { id: "task-1" } } });
  });

  it("reuses the PR Info result schema", () => {
    expect(
      PRInfoResultSchema.parse({
        repositoryInfo: { owner: "octo", repository: "repo" },
        projectSummary: "TypeScript",
        prInfo: { title: "Change", prNumber: 42 },
      }),
    ).toMatchObject({
      repositoryInfo: { owner: "octo", repository: "repo" },
      prInfo: { prNumber: 42 },
    });
  });
});
