import { describe, expect, it } from "vitest";
import {
  hasInlineReviewComments,
  hasProductionCodeChange,
  isDocFile,
  isProductionCodeFile,
  isQualifyingInlineComment,
  isTestFile,
} from "./target-criteria.js";

describe("production code criteria", () => {
  it.each([
    "src/app.ts",
    "package.json",
    "angular.json",
    "svelte.config.js",
    "svelte.config.ts",
    "vue.config.js",
    "vue.config.ts",
  ])("accepts %s", (path) => {
    expect(isProductionCodeFile(path)).toBe(true);
  });

  it.each([
    "",
    "src/my-angular.json",
    "src/not-package.json",
    "backend/app.py",
    "src/app.test.ts",
    "test.ts",
    "src/theme.test.scss",
    "src/layout.spec.css",
    "tests/fixture.ts",
    "docs/example.ts",
    "docs/app.ts.md",
  ])("rejects %s", (path) => {
    expect(isProductionCodeFile(path)).toBe(false);
  });

  it("normalizes Windows separators for test and documentation directories", () => {
    expect(isTestFile("src\\__tests__\\a.ts")).toBe(true);
    expect(isDocFile("src\\docs\\example.ts")).toBe(true);
  });

  it("requires a truthy patch on a production file", () => {
    expect(hasProductionCodeChange([{ filename: "src/app.ts", patch: null }])).toBe(false);
    expect(hasProductionCodeChange([{ filename: "src/app.ts", patch: "" }])).toBe(false);
    expect(hasProductionCodeChange([{ filename: "src/app.ts", patch: "+code" }])).toBe(true);
  });
});

describe("inline review criteria", () => {
  it.each([
    { body: "fix", path: "src/app.ts", user: { login: "alice" } },
    { body: "fix", path: "src/app.ts", user: { login: "coderabbitai[bot]" } },
  ])("accepts qualifying comments regardless of author", (comment) => {
    expect(isQualifyingInlineComment(comment)).toBe(true);
  });

  it.each([
    { body: "fix" },
    { body: "fix", path: "backend/app.py" },
    { body: "  ", path: "src/app.ts" },
  ])("rejects non-qualifying comments", (comment) => {
    expect(isQualifyingInlineComment(comment)).toBe(false);
  });

  it("detects whether any inline comment qualifies", () => {
    expect(
      hasInlineReviewComments([
        { body: "", path: "src/app.ts" },
        { body: "fix", path: "src/app.ts" },
      ]),
    ).toBe(true);
    expect(hasInlineReviewComments([{ body: "review body only" }])).toBe(false);
  });
});
