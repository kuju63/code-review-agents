import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createSettingsStore } from "../settings/settings.store.js";
import { registerGithubRoutes } from "./github.route.js";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildTestApp(fetchMock: typeof globalThis.fetch) {
  const app = createApp();
  const store = createSettingsStore();
  store.updateGithubSettings({
    githubUrl: "https://github.com",
    personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  });
  registerGithubRoutes(app, store, { fetch: fetchMock });
  return app;
}

describe("GET /github/orgs", () => {
  it("returns 200 with the mapped org list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [{ login: "acme-corp", id: 1 }]));
    const app = buildTestApp(fetchMock);

    const res = await app.request("/github/orgs");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([{ name: "acme-corp", id: 1 }]);
  });

  it("returns 401 unauthorized when no PAT is registered", async () => {
    const fetchMock = vi.fn();
    const app = createApp();
    registerGithubRoutes(app, createSettingsStore(), { fetch: fetchMock });

    const res = await app.request("/github/orgs");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 unauthorized when GitHub itself rejects the PAT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: "Bad credentials" }));
    const app = buildTestApp(fetchMock);

    const res = await app.request("/github/orgs");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("unauthorized");
  });

  it("returns 502 upstream_github_failure on a GitHub 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, { message: "down" }));
    const app = buildTestApp(fetchMock);

    const res = await app.request("/github/orgs");

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_github_failure");
  });
});

describe("GET /github/repos", () => {
  it("returns 422 validation_error when org is missing", async () => {
    const fetchMock = vi.fn();
    const app = buildTestApp(fetchMock);

    const res = await app.request("/github/repos");

    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the mapped repository list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, [
          { name: "web-frontend", id: 789012, default_branch: "main", open_issues_count: 3 },
        ]),
      );
    const app = buildTestApp(fetchMock);

    const res = await app.request("/github/repos?org=acme-corp");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      { name: "web-frontend", id: 789012, defaultBranch: "main", openIssuesCount: 3 },
    ]);
  });
});

describe("GET /github/prs", () => {
  it("returns 422 validation_error when repo is missing", async () => {
    const fetchMock = vi.fn();
    const app = buildTestApp(fetchMock);

    const res = await app.request("/github/prs?org=acme-corp");

    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the mapped PR list", async () => {
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
    const app = buildTestApp(fetchMock);

    const res = await app.request("/github/prs?org=acme-corp&repo=web-frontend");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      {
        number: 482,
        title: "ユーザー認証フローの改善",
        state: "open",
        createdAt: "2026-08-01T09:00:00Z",
        author: "sato.k",
        baseBranch: "main",
      },
    ]);
  });
});
