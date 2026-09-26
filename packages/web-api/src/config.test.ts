import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "./config.js";

describe("loadConfigFromEnv", () => {
  it("defaults githubAllowedHost to github.com when unset", () => {
    const config = loadConfigFromEnv({});

    expect(config.githubAllowedHost).toBe("github.com");
  });

  it("reads GITHUB_ALLOWED_HOST from the environment for GitHub Enterprise Server deployments", () => {
    const config = loadConfigFromEnv({ GITHUB_ALLOWED_HOST: "github.example.com" });

    expect(config.githubAllowedHost).toBe("github.example.com");
  });

  it("normalizes GITHUB_ALLOWED_HOST to lowercase", () => {
    const config = loadConfigFromEnv({ GITHUB_ALLOWED_HOST: "GitHub.Example.COM" });

    expect(config.githubAllowedHost).toBe("github.example.com");
  });

  it("rejects an empty GITHUB_ALLOWED_HOST", () => {
    expect(() => loadConfigFromEnv({ GITHUB_ALLOWED_HOST: "   " })).toThrow();
  });

  it("rejects a GITHUB_ALLOWED_HOST containing a port", () => {
    expect(() => loadConfigFromEnv({ GITHUB_ALLOWED_HOST: "github.example.com:443" })).toThrow();
  });

  it("rejects a GITHUB_ALLOWED_HOST containing a path", () => {
    expect(() => loadConfigFromEnv({ GITHUB_ALLOWED_HOST: "github.example.com/path" })).toThrow();
  });
});
