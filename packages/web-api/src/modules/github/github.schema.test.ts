import { describe, expect, it } from "vitest";
import {
  GithubOrgListResponseSchema,
  GithubOrgQuerySchema,
  GithubPullRequestListResponseSchema,
  GithubRepoQuerySchema,
  GithubRepositoryListResponseSchema,
} from "./github.schema.js";

describe("GithubOrgListResponseSchema", () => {
  it("accepts a well-formed org list response", () => {
    const result = GithubOrgListResponseSchema.safeParse({
      apiVersion: "1.0.0",
      items: [{ name: "acme-corp", id: 123456 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an item missing the numeric id", () => {
    const result = GithubOrgListResponseSchema.safeParse({
      apiVersion: "1.0.0",
      items: [{ name: "acme-corp" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("GithubRepositoryListResponseSchema", () => {
  it("accepts a well-formed repository list response", () => {
    const result = GithubRepositoryListResponseSchema.safeParse({
      apiVersion: "1.0.0",
      items: [
        {
          name: "web-frontend",
          id: 789012,
          defaultBranch: "main",
          openIssuesCount: 3,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative openIssuesCount", () => {
    const result = GithubRepositoryListResponseSchema.safeParse({
      apiVersion: "1.0.0",
      items: [
        {
          name: "web-frontend",
          id: 789012,
          defaultBranch: "main",
          openIssuesCount: -1,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("GithubPullRequestListResponseSchema", () => {
  it("accepts a well-formed PR list response", () => {
    const result = GithubPullRequestListResponseSchema.safeParse({
      apiVersion: "1.0.0",
      items: [
        {
          number: 482,
          title: "ユーザー認証フローの改善",
          state: "open",
          createdAt: "2026-08-01T09:00:00Z",
          author: "sato.k",
          baseBranch: "main",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid PrState value", () => {
    const result = GithubPullRequestListResponseSchema.safeParse({
      apiVersion: "1.0.0",
      items: [
        {
          number: 482,
          title: "x",
          state: "draft",
          createdAt: "2026-08-01T09:00:00Z",
          author: "sato.k",
          baseBranch: "main",
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("GithubOrgQuerySchema", () => {
  it("rejects a missing org", () => {
    const result = GithubOrgQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an empty org", () => {
    const result = GithubOrgQuerySchema.safeParse({ org: "" });
    expect(result.success).toBe(false);
  });
});

describe("GithubRepoQuerySchema", () => {
  it("rejects a missing repo", () => {
    const result = GithubRepoQuerySchema.safeParse({ org: "acme-corp" });
    expect(result.success).toBe(false);
  });
});
