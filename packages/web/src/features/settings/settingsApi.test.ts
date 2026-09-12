import { describe, expect, it, vi } from "vitest";
import { setApiFetchHandler } from "../../test/setup";
import type { GithubSettings } from "./settings.schema";
import { fetchGithubSettings, updateGithubSettings } from "./settingsApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function settings(overrides: Partial<GithubSettings> = {}): GithubSettings {
  return {
    apiVersion: "1.0.0",
    githubUrl: "https://github.com",
    hasPersonalAccessToken: false,
    updatedAt: "2026-08-09T10:24:00+09:00",
    ...overrides,
  };
}

describe("fetchGithubSettings", () => {
  it("returns the parsed settings on 200", async () => {
    setApiFetchHandler(async () => jsonResponse(settings({ hasPersonalAccessToken: true })));

    const result = await fetchGithubSettings();

    expect(result.hasPersonalAccessToken).toBe(true);
  });

  it("requests GET /settings/github", async () => {
    const handler = vi.fn().mockResolvedValue(jsonResponse(settings()));
    setApiFetchHandler(handler);

    await fetchGithubSettings();

    expect(String(handler.mock.calls[0]?.[0])).toContain("/settings/github");
    expect(handler.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
  });

  it("throws on a response that fails schema validation (contract drift)", async () => {
    setApiFetchHandler(async () => jsonResponse({ githubUrl: "https://github.com" }));

    await expect(fetchGithubSettings()).rejects.toBeTruthy();
  });

  it("throws when the server responds with a non-2xx status", async () => {
    setApiFetchHandler(async () => jsonResponse({}, 500));

    await expect(fetchGithubSettings()).rejects.toBeTruthy();
  });
});

describe("updateGithubSettings", () => {
  it("PUTs the given url and token and returns the parsed settings on 200", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue(jsonResponse(settings({ hasPersonalAccessToken: true })));
    setApiFetchHandler(handler);

    const result = await updateGithubSettings({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    expect(result).toEqual({ ok: true, data: settings({ hasPersonalAccessToken: true }) });
    const [url, init] = handler.mock.calls[0] ?? [];
    expect(String(url)).toContain("/settings/github");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
  });

  it("omits personalAccessToken from the request body when not provided", async () => {
    const handler = vi.fn().mockResolvedValue(jsonResponse(settings()));
    setApiFetchHandler(handler);

    await updateGithubSettings({ githubUrl: "https://github.example.com" });

    const [, init] = handler.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ githubUrl: "https://github.example.com" });
  });

  it("returns a validation_error result with the server message on 422", async () => {
    setApiFetchHandler(async () =>
      jsonResponse(
        {
          apiVersion: "1.0.0",
          code: "validation_error",
          message: "Personal Access Tokenを入力してください。",
          detail: null,
        },
        422,
      ),
    );

    const result = await updateGithubSettings({ githubUrl: "https://github.example.com" });

    expect(result).toEqual({
      ok: false,
      code: "validation_error",
      message: "Personal Access Tokenを入力してください。",
    });
  });

  it("throws on an unexpected status code", async () => {
    setApiFetchHandler(async () => jsonResponse({}, 500));

    await expect(
      updateGithubSettings({ githubUrl: "https://github.example.com" }),
    ).rejects.toBeTruthy();
  });
});
