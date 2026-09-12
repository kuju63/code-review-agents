import { describe, expect, it, vi } from "vitest";
import {
  listGithubOrgs,
  listGithubPullRequests,
  listGithubRepositories,
  resolveGithubApiBase,
} from "./github.client.js";

const credentials = {
  githubUrl: "https://github.com",
  personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("resolveGithubApiBase", () => {
  it("resolves github.com to api.github.com", () => {
    expect(resolveGithubApiBase("https://github.com")).toBe("https://api.github.com");
  });

  it("normalizes a trailing slash before resolving", () => {
    expect(resolveGithubApiBase("https://github.com/")).toBe("https://api.github.com");
  });

  it("resolves a GitHub Enterprise Server URL to its /api/v3 base", () => {
    expect(resolveGithubApiBase("https://github.example.com")).toBe(
      "https://github.example.com/api/v3",
    );
  });
});

describe("listGithubOrgs", () => {
  it("maps login/id and calls GET /user/orgs with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [{ login: "acme-corp", id: 1 }]));

    const result = await listGithubOrgs(credentials, { fetch: fetchMock });

    expect(result).toEqual({ ok: true, data: [{ name: "acme-corp", id: 1 }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/user/orgs");
    expect(init.headers.authorization).toBe(`Bearer ${credentials.personalAccessToken}`);
  });

  it("returns unauthorized on a 401 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: "Bad credentials" }));

    const result = await listGithubOrgs(credentials, { fetch: fetchMock });

    expect(result).toEqual({
      ok: false,
      code: "unauthorized",
      message: expect.any(String),
    });
  });

  it("returns upstream_github_failure on a 500 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: "boom" }));

    const result = await listGithubOrgs(credentials, { fetch: fetchMock });

    expect(result).toEqual({
      ok: false,
      code: "upstream_github_failure",
      message: expect.any(String),
    });
  });

  it("never leaks the PAT into an error message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: "boom" }));

    const result = await listGithubOrgs(credentials, { fetch: fetchMock });

    expect(JSON.stringify(result)).not.toContain(credentials.personalAccessToken);
  });

  it("returns upstream_github_failure when fetch itself rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await listGithubOrgs(credentials, { fetch: fetchMock });

    expect(result).toEqual({
      ok: false,
      code: "upstream_github_failure",
      message: expect.any(String),
    });
  });
});

describe("listGithubRepositories", () => {
  it("calls GET /orgs/{org}/repos and maps snake_case fields to camelCase", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, [
          { name: "web-frontend", id: 789012, default_branch: "main", open_issues_count: 3 },
        ]),
      );

    const result = await listGithubRepositories(credentials, "acme-corp", { fetch: fetchMock });

    expect(result).toEqual({
      ok: true,
      data: [{ name: "web-frontend", id: 789012, defaultBranch: "main", openIssuesCount: 3 }],
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/orgs/acme-corp/repos");
  });

  it("URL-encodes the org so it cannot escape the path segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));

    await listGithubRepositories(credentials, "acme/../evil", { fetch: fetchMock });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/orgs/acme%2F..%2Fevil/repos");
  });
});

describe("listGithubPullRequests", () => {
  it("calls GET /repos/{org}/{repo}/pulls?state=open and maps fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, [
        {
          number: 482,
          title: "ユーザー認証フローの改善",
          state: "open",
          created_at: "2026-08-01T09:00:00Z",
          user: { login: "sato.k" },
          base: { ref: "main" },
        },
      ]),
    );

    const result = await listGithubPullRequests(credentials, "acme-corp", "web-frontend", {
      fetch: fetchMock,
    });

    expect(result).toEqual({
      ok: true,
      data: [
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
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme-corp/web-frontend/pulls?state=open");
  });
});
