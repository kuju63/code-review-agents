import { describe, expect, it } from "vitest";
import {
  GithubOrgListResponseSchema,
  GithubPullRequestListResponseSchema,
  GithubRepositoryListResponseSchema,
  RegisterReviewRequestSchema,
  ReviewSchema,
} from "./reviewRequest.schema";

describe("GithubOrgListResponseSchema", () => {
  it("accepts a well-formed org list", () => {
    expect(() =>
      GithubOrgListResponseSchema.parse({
        apiVersion: "1.0.0",
        items: [{ name: "acme-corp", id: 1 }],
      }),
    ).not.toThrow();
  });

  it("rejects an item missing id", () => {
    expect(() =>
      GithubOrgListResponseSchema.parse({ apiVersion: "1.0.0", items: [{ name: "acme-corp" }] }),
    ).toThrow();
  });
});

describe("GithubRepositoryListResponseSchema", () => {
  it("accepts a well-formed repository list", () => {
    expect(() =>
      GithubRepositoryListResponseSchema.parse({
        apiVersion: "1.0.0",
        items: [{ name: "web-frontend", id: 1, defaultBranch: "main", openIssuesCount: 0 }],
      }),
    ).not.toThrow();
  });
});

describe("GithubPullRequestListResponseSchema", () => {
  function pr(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      number: 482,
      title: "Fix login bug",
      state: "open",
      createdAt: "2026-08-09T10:24:00Z",
      author: "octocat",
      baseBranch: "main",
      ...overrides,
    };
  }

  it("accepts a well-formed PR list", () => {
    expect(() =>
      GithubPullRequestListResponseSchema.parse({ apiVersion: "1.0.0", items: [pr()] }),
    ).not.toThrow();
  });

  it("rejects a non-RFC3339 createdAt (contract drift)", () => {
    expect(() =>
      GithubPullRequestListResponseSchema.parse({
        apiVersion: "1.0.0",
        items: [pr({ createdAt: "2026-08-09 10:24" })],
      }),
    ).toThrow();
  });

  it("rejects an unknown PR state", () => {
    expect(() =>
      GithubPullRequestListResponseSchema.parse({
        apiVersion: "1.0.0",
        items: [pr({ state: "draft" })],
      }),
    ).toThrow();
  });
});

describe("RegisterReviewRequestSchema", () => {
  it("accepts the 3 required fields without commitSha", () => {
    expect(() =>
      RegisterReviewRequestSchema.parse({
        organization: "acme-corp",
        repository: "web-frontend",
        pullRequest: 482,
      }),
    ).not.toThrow();
  });

  it("rejects pullRequest <= 0", () => {
    expect(() =>
      RegisterReviewRequestSchema.parse({
        organization: "acme-corp",
        repository: "web-frontend",
        pullRequest: 0,
      }),
    ).toThrow();
  });

  it("rejects an empty organization", () => {
    expect(() =>
      RegisterReviewRequestSchema.parse({
        organization: "",
        repository: "web-frontend",
        pullRequest: 1,
      }),
    ).toThrow();
  });
});

describe("ReviewSchema (POST /reviews response subset)", () => {
  it("accepts the fields the client reads", () => {
    expect(() =>
      ReviewSchema.parse({
        reviewId: "acme-corp:web-frontend:pr-482",
        organization: "acme-corp",
        repository: "web-frontend",
        pullRequest: 482,
      }),
    ).not.toThrow();
  });
});
