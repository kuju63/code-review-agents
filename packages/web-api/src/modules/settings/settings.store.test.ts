import { describe, expect, it } from "vitest";
import { createSettingsStore } from "./settings.store.js";

describe("createSettingsStore — getGithubSettings", () => {
  it("returns the default githubUrl and no PAT before anything is saved", () => {
    const store = createSettingsStore();
    const settings = store.getGithubSettings();

    expect(settings.githubUrl).toBe("https://github.com");
    expect(settings.hasPersonalAccessToken).toBe(false);
  });
});

describe("createSettingsStore — updateGithubSettings", () => {
  it("saves the URL and PAT on first registration", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.githubUrl).toBe("https://github.example.com");
      expect(result.data.hasPersonalAccessToken).toBe(true);
    }
  });

  it("rejects first registration when the PAT is omitted (SET-V05)", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({ githubUrl: "https://github.example.com" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation_error");
    }
  });

  it("keeps the existing PAT when omitted on a subsequent update (SCR-04 §4)", () => {
    const store = createSettingsStore();
    store.updateGithubSettings({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    const result = store.updateGithubSettings({ githubUrl: "https://github2.example.com" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.githubUrl).toBe("https://github2.example.com");
      expect(result.data.hasPersonalAccessToken).toBe(true);
    }
  });

  it("replaces the PAT when a new value is supplied", () => {
    const store = createSettingsStore();
    store.updateGithubSettings({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_first0000000000000000000000000000000",
    });

    const result = store.updateGithubSettings({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_second00000000000000000000000000000",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hasPersonalAccessToken).toBe(true);
    }
  });

  it("normalizes trailing slashes on save (SET-A01)", () => {
    const store = createSettingsStore();
    const result = store.updateGithubSettings({
      githubUrl: "https://github.example.com///",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.githubUrl).toBe("https://github.example.com");
    }
  });

  it("never exposes the raw PAT value from getGithubSettings after saving", () => {
    const store = createSettingsStore();
    store.updateGithubSettings({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_supersecretvalue0000000000000000000",
    });

    const settings = store.getGithubSettings();
    expect(JSON.stringify(settings)).not.toContain("ghp_supersecretvalue");
  });

  it("advances updatedAt on every successful save", () => {
    let tick = 0;
    const store = createSettingsStore({ now: () => `t${tick++}` });

    const first = store.updateGithubSettings({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    const second = store.updateGithubSettings({ githubUrl: "https://github2.example.com" });

    expect(first.ok && first.data.updatedAt).not.toBe(second.ok && second.data.updatedAt);
  });
});
