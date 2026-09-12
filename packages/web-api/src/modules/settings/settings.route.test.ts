import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { registerSettingsRoutes } from "./settings.route.js";
import { createSettingsStore } from "./settings.store.js";

function buildTestApp() {
  const app = createApp();
  const store = createSettingsStore();
  registerSettingsRoutes(app, store);
  return app;
}

describe("GET /settings/github", () => {
  it("returns 200 with default values before anything is saved", async () => {
    const app = buildTestApp();
    const res = await app.request("/settings/github");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.githubUrl).toBe("https://github.com");
    expect(body.hasPersonalAccessToken).toBe(false);
    expect(body).not.toHaveProperty("personalAccessToken");
  });
});

describe("PUT /settings/github", () => {
  it("saves the URL and PAT on first registration", async () => {
    const app = buildTestApp();
    const res = await app.request("/settings/github", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubUrl: "https://github.example.com",
        personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.githubUrl).toBe("https://github.example.com");
    expect(body.hasPersonalAccessToken).toBe(true);
  });

  it("returns 422 validation_error when the URL is not https (SET-V02)", async () => {
    const app = buildTestApp();
    const res = await app.request("/settings/github", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubUrl: "http://github.example.com",
        personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation_error");
  });

  it("returns 422 validation_error when the PAT is omitted on first registration (SET-V05)", async () => {
    const app = buildTestApp();
    const res = await app.request("/settings/github", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubUrl: "https://github.example.com" }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation_error");
  });

  it("keeps the existing PAT when omitted on a subsequent update", async () => {
    const app = buildTestApp();
    await app.request("/settings/github", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubUrl: "https://github.example.com",
        personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      }),
    });

    const res = await app.request("/settings/github", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubUrl: "https://github2.example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.githubUrl).toBe("https://github2.example.com");
    expect(body.hasPersonalAccessToken).toBe(true);
  });

  it("never includes the raw PAT anywhere in the response or error body", async () => {
    const app = buildTestApp();
    const secretToken = "ghp_thisIsASecretValueThatMustNotLeak00";
    const res = await app.request("/settings/github", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubUrl: "http://github.example.com",
        personalAccessToken: secretToken,
      }),
    });

    const rawText = await res.text();
    expect(rawText).not.toContain(secretToken);
  });
});
