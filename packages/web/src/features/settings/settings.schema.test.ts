import { describe, expect, it } from "vitest";
import {
  GithubSettingsSchema,
  normalizeGithubUrl,
  validateGithubUrl,
  validatePersonalAccessToken,
} from "./settings.schema";

describe("validateGithubUrl (SET-V01〜V04)", () => {
  it("SET-V01: rejects an empty value", () => {
    expect(validateGithubUrl("")).toBe("required");
    expect(validateGithubUrl("   ")).toBe("required");
  });

  it("SET-V01: rejects a value over 2,048 characters", () => {
    const tooLong = `https://github.com/${"a".repeat(2048)}`;
    expect(validateGithubUrl(tooLong)).toBe("tooLong");
  });

  it("SET-V02: rejects an unparsable URL", () => {
    expect(validateGithubUrl("not a url")).toBe("invalidHttps");
  });

  it("SET-V02: rejects a non-https scheme", () => {
    expect(validateGithubUrl("http://github.example.com")).toBe("invalidHttps");
  });

  it("SET-V03: rejects userinfo, query, and fragment", () => {
    expect(validateGithubUrl("https://user:pass@github.example.com")).toBe("invalidRoot");
    expect(validateGithubUrl("https://github.example.com?x=1")).toBe("invalidRoot");
    expect(validateGithubUrl("https://github.example.com#frag")).toBe("invalidRoot");
  });

  it("SET-V04: rejects a multi-segment path", () => {
    expect(validateGithubUrl("https://github.example.com/a/b")).toBe("invalidRoot");
  });

  it("accepts a bare root URL", () => {
    expect(validateGithubUrl("https://github.com")).toBeUndefined();
  });

  it("SET-V04: accepts a trailing slash root", () => {
    expect(validateGithubUrl("https://github.com/")).toBeUndefined();
  });

  it("SET-V04: accepts a single fixed base-path segment (GHE subpath)", () => {
    expect(validateGithubUrl("https://example.com/ghe")).toBeUndefined();
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateGithubUrl("  https://github.com  ")).toBeUndefined();
  });
});

describe("normalizeGithubUrl (SET-A01)", () => {
  it("trims whitespace and drops trailing slashes", () => {
    expect(normalizeGithubUrl("  https://github.com/// ")).toBe("https://github.com");
  });

  it("leaves a URL without a trailing slash unchanged", () => {
    expect(normalizeGithubUrl("https://github.com")).toBe("https://github.com");
  });
});

describe("validatePersonalAccessToken (SET-V05〜V09)", () => {
  it("SET-V05: requires a value on first registration", () => {
    expect(validatePersonalAccessToken("", false)).toBe("required");
  });

  it("SET-V05: allows a blank value when a token is already registered", () => {
    expect(validatePersonalAccessToken("", true)).toBeUndefined();
  });

  it("SET-V06: rejects a value over 4,096 characters", () => {
    const tooLong = `ghp_${"a".repeat(4096)}`;
    expect(validatePersonalAccessToken(tooLong, false)).toBe("invalidLength");
  });

  it("SET-V06: rejects whitespace anywhere in the value without trimming", () => {
    expect(validatePersonalAccessToken("ghp_abc def", false)).toBe("invalidLength");
    expect(validatePersonalAccessToken(" ghp_abcdef", false)).toBe("invalidLength");
  });

  it("SET-V07/V08: rejects a value without a recognized prefix", () => {
    expect(validatePersonalAccessToken("token_abcdef", false)).toBe("invalidPrefix");
  });

  it("SET-V07/V08: prefix matching is case-sensitive", () => {
    expect(validatePersonalAccessToken("GHP_abcdef", false)).toBe("invalidPrefix");
  });

  it("SET-V09: rejects a prefix with nothing after it", () => {
    expect(validatePersonalAccessToken("ghp_", false)).toBe("incomplete");
    expect(validatePersonalAccessToken("github_pat_", false)).toBe("incomplete");
  });

  it("accepts a well-formed Classic PAT", () => {
    expect(
      validatePersonalAccessToken("ghp_abcdefghijklmnopqrstuvwxyz0123456789", false),
    ).toBeUndefined();
  });

  it("accepts a well-formed Fine-grained PAT", () => {
    expect(
      validatePersonalAccessToken("github_pat_abcdefghijklmnopqrstuvwxyz0123456789", false),
    ).toBeUndefined();
  });
});

describe("GithubSettingsSchema", () => {
  it("parses a well-formed response", () => {
    const result = GithubSettingsSchema.parse({
      apiVersion: "1.0.0",
      githubUrl: "https://github.com",
      hasPersonalAccessToken: true,
      updatedAt: "2026-08-09T10:24:00+09:00",
    });
    expect(result.hasPersonalAccessToken).toBe(true);
  });

  it("rejects a response missing required fields", () => {
    expect(() => GithubSettingsSchema.parse({ githubUrl: "https://github.com" })).toThrow();
  });
});
