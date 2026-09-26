import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { createSettingsStore } from "./settings.store.js";

describe("createSettingsStore — getGithubSettings", () => {
  it("returns the default githubUrl and no PAT before anything is saved", () => {
    const store = createSettingsStore();
    const settings = store.getGithubSettings();

    expect(settings.githubUrl).toBe("https://github.com");
    expect(settings.hasPersonalAccessToken).toBe(false);
  });

  it("returns the operator-configured allowed host as the initial githubUrl (GHES)", () => {
    const store = createSettingsStore({ allowedGithubHost: "github.example.com" });
    const settings = store.getGithubSettings();

    expect(settings.githubUrl).toBe("https://github.example.com");
  });
});

describe("createSettingsStore — updateGithubSettings", () => {
  it("saves the URL and PAT on first registration", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    assert(result.ok);
    expect(result.data.githubUrl).toBe("https://github.com");
    expect(result.data.hasPersonalAccessToken).toBe(true);
  });

  it("rejects first registration when the PAT is omitted (SET-V05)", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({ githubUrl: "https://github.com" });

    assert(!result.ok);
    expect(result.code).toBe("validation_error");
  });

  it("keeps the existing PAT when omitted on a subsequent update (SCR-04 §4)", () => {
    const store = createSettingsStore();
    store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    const result = store.updateGithubSettings({ githubUrl: "https://github.com/" });

    assert(result.ok);
    expect(result.data.githubUrl).toBe("https://github.com");
    expect(result.data.hasPersonalAccessToken).toBe(true);
  });

  it("replaces the PAT when a new value is supplied", () => {
    const store = createSettingsStore();
    store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_first0000000000000000000000000000000",
    });

    const result = store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_second00000000000000000000000000000",
    });

    assert(result.ok);
    expect(result.data.hasPersonalAccessToken).toBe(true);
  });

  it("normalizes trailing slashes on save (SET-A01)", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({
      githubUrl: "https://github.com///",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    assert(result.ok);
    expect(result.data.githubUrl).toBe("https://github.com");
  });

  it("never exposes the raw PAT value from getGithubSettings after saving", () => {
    const store = createSettingsStore();
    store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_supersecretvalue0000000000000000000",
    });

    const settings = store.getGithubSettings();
    expect(JSON.stringify(settings)).not.toContain("ghp_supersecretvalue");
  });

  it("advances updatedAt on every successful save", () => {
    let tick = 0;
    const store = createSettingsStore({ now: () => `t${tick++}` });

    const first = store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    const second = store.updateGithubSettings({ githubUrl: "https://github.com/" });

    assert(first.ok);
    assert(second.ok);
    expect(first.data.updatedAt).not.toBe(second.data.updatedAt);
  });
});

describe("createSettingsStore — githubUrl host pinning (SET-V11)", () => {
  it("rejects a host other than the default allowed host (github.com)", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({
      githubUrl: "https://attacker.example.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    assert(!result.ok);
    expect(result.code).toBe("validation_error");
  });

  it("rejects an update that changes githubUrl to a disallowed host even when a PAT already exists", () => {
    const store = createSettingsStore();
    store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    const result = store.updateGithubSettings({ githubUrl: "https://attacker.example.com" });

    assert(!result.ok);
    expect(result.code).toBe("validation_error");
  });

  it("accepts the operator-configured allowed host (GitHub Enterprise Server)", () => {
    const store = createSettingsStore({ allowedGithubHost: "github.example.com" });
    const result = store.updateGithubSettings({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    assert(result.ok);
    expect(result.data.githubUrl).toBe("https://github.example.com");
  });

  it("rejects github.com when the operator has pinned a different allowed host", () => {
    const store = createSettingsStore({ allowedGithubHost: "github.example.com" });
    const result = store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    assert(!result.ok);
    expect(result.code).toBe("validation_error");
  });

  it("accepts the host case-insensitively but normalizes the stored value to the pinned casing", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({
      githubUrl: "https://GitHub.COM",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    assert(result.ok);
    // Must round-trip through resolveGithubApiBase()'s case-sensitive
    // `=== "https://github.com"` check, not preserve the caller's casing.
    expect(result.data.githubUrl).toBe("https://github.com");
  });

  it("rejects a subpath under the allowed host (path confusion around the pin)", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({
      githubUrl: "https://github.com/evil",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    assert(!result.ok);
    expect(result.code).toBe("validation_error");
  });

  it("accepts the initial githubUrl unchanged on first registration for a custom allowed host (GET/PUT consistency)", () => {
    const store = createSettingsStore({ allowedGithubHost: "github.example.com" });
    const initial = store.getGithubSettings();

    const result = store.updateGithubSettings({
      githubUrl: initial.githubUrl,
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    assert(result.ok);
    expect(result.data.githubUrl).toBe("https://github.example.com");
  });
});

describe("createSettingsStore — getCredentials", () => {
  it("returns null before any PAT has been saved (Issue #335)", () => {
    const store = createSettingsStore();
    expect(store.getCredentials()).toBeNull();
  });

  it("returns the githubUrl and raw PAT once saved", () => {
    const store = createSettingsStore();
    store.updateGithubSettings({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    expect(store.getCredentials()).toEqual({
      githubUrl: "https://github.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
  });
});
