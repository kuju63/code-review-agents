import { describe, expect, it } from "vitest";
import { GithubSettingsSchema, UpdateGithubSettingsRequestSchema } from "./settings.schema.js";

describe("UpdateGithubSettingsRequestSchema — githubUrl (SET-V01〜V04)", () => {
  it("accepts a plain https root URL", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://github.example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty githubUrl (SET-V01)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({ githubUrl: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a githubUrl longer than 2048 characters (SET-V01)", () => {
    const longUrl = `https://github.example.com/${"a".repeat(2048)}`;
    const result = UpdateGithubSettingsRequestSchema.safeParse({ githubUrl: longUrl });
    expect(result.success).toBe(false);
  });

  it("rejects a non-https scheme (SET-V02)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "http://github.example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a value that is not an absolute URL (SET-V02)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({ githubUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects a URL containing userinfo (SET-V03)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://user:pass@github.example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a URL containing a query parameter (SET-V03)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://github.example.com/?foo=bar",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a URL containing a fragment (SET-V03)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://github.example.com/#frag",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a root path of '/'", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://github.example.com/",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a single fixed base path segment for GHES subpath deployments (SET-V04)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://ghe.example.com/ghe",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a path containing consecutive slashes (SET-V04)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://ghe.example.com//ghe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a path segment containing an encoded slash (%2F) (SET-V04)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://ghe.example.com/foo%2Fbar",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a path segment containing an encoded backslash (%5C) (SET-V04)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: "https://ghe.example.com/foo%5Cbar",
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateGithubSettingsRequestSchema — personalAccessToken (SET-V05〜V09)", () => {
  const validUrl = "https://github.example.com";

  it("accepts an omitted personalAccessToken (kept-as-is by the store)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({ githubUrl: validUrl });
    expect(result.success).toBe(true);
  });

  it("accepts a Classic PAT (ghp_ prefix, SET-V07)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: validUrl,
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a Fine-grained PAT (github_pat_ prefix, SET-V08)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: validUrl,
      personalAccessToken: "github_pat_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a PAT longer than 4096 characters (SET-V06)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: validUrl,
      personalAccessToken: `ghp_${"a".repeat(4096)}`,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a PAT containing whitespace (SET-V06)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: validUrl,
      personalAccessToken: "ghp_abc def",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a PAT without ghp_/github_pat_ prefix (SET-V07/V08)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: validUrl,
      personalAccessToken: "invalid_token_abcdefgh",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a case-mismatched prefix (SET-V07/V08 are case-sensitive)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: validUrl,
      personalAccessToken: "GHP_abcdefghijklmnopqrstuvwxyz",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a prefix with nothing following it (SET-V09)", () => {
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: validUrl,
      personalAccessToken: "ghp_",
    });
    expect(result.success).toBe(false);
  });

  it("never echoes the raw token value inside issue messages", () => {
    const secret = "ghp_thisIsASecretValueThatMustNotLeak";
    const result = UpdateGithubSettingsRequestSchema.safeParse({
      githubUrl: validUrl,
      personalAccessToken: `${secret} `,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const serialized = JSON.stringify(result.error.issues);
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("GithubSettingsSchema", () => {
  it("never declares a field for the raw PAT value", () => {
    expect(Object.keys(GithubSettingsSchema.shape)).not.toContain("personalAccessToken");
  });

  it("parses a fully-populated response", () => {
    const result = GithubSettingsSchema.safeParse({
      apiVersion: "1.0.0",
      githubUrl: "https://github.example.com",
      hasPersonalAccessToken: true,
      updatedAt: "2026-08-09T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});
