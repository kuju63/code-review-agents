import { describe, expect, it } from "vitest";
import type { PRInfoResult } from "../models/pr-info.js";
import type { ReviewContext } from "../models/review.js";
import {
  annotatePatch,
  buildPrompt,
  composeSystemPrompt,
  STRUCTURED_OUTPUT_DIRECTIVE,
} from "./base-reviewer.js";

function makePrInfo(overrides: Partial<PRInfoResult> = {}): PRInfoResult {
  return {
    repositoryInfo: { owner: "octocat", repository: "hello" },
    projectSummary: "A demo repo",
    prInfo: {
      title: "Add feature",
      prNumber: 42,
      body: "Some body",
      labels: ["bug", "priority"],
      fileChanges: [{ filePath: "src/a.ts", patch: "@@ -1,1 +1,1 @@\n-old\n+new" }],
    },
    dependencyFiles: ["package.json"],
    manifestContents: {},
    ...overrides,
  };
}

describe("STRUCTURED_OUTPUT_DIRECTIVE", () => {
  it("instructs the model to avoid prose/markdown output", () => {
    const lower = STRUCTURED_OUTPUT_DIRECTIVE.toLowerCase();
    expect(lower).toMatch(/markdown|prose/);
    expect(lower).toContain("structured output");
  });

  it("requires filePath and line for location-specific findings", () => {
    expect(STRUCTURED_OUTPUT_DIRECTIVE).toContain("filePath");
    expect(STRUCTURED_OUTPUT_DIRECTIVE).toContain("line");
    expect(STRUCTURED_OUTPUT_DIRECTIVE).toContain("comment");
  });

  it("explains the consequence of leaving location fields unset", () => {
    const lower = STRUCTURED_OUTPUT_DIRECTIVE.toLowerCase();
    expect(lower).toMatch(/dropped|discarded|excluded/);
  });
});

describe("composeSystemPrompt", () => {
  it("appends the structured output directive to the role prompt", () => {
    const composed = composeSystemPrompt("ROLE PROMPT");
    expect(composed.startsWith("ROLE PROMPT")).toBe(true);
    expect(composed).toContain(STRUCTURED_OUTPUT_DIRECTIVE);
    expect(composed).not.toBe("ROLE PROMPT");
  });
});

describe("annotatePatch", () => {
  it("annotates added lines with the new file line number", () => {
    const patch = "@@ -1,2 +1,3 @@\n context\n+added line";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -1,2 +1,3 @@\n L1:context\n+L2:added line");
  });

  it("annotates removed lines with the old file line number", () => {
    const patch = "@@ -1,2 +1,1 @@\n context\n-removed line";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -1,2 +1,1 @@\n L1:context\n-L2:removed line");
  });

  it("does not increment the new-line counter for removed lines", () => {
    const patch = "@@ -1,3 +1,1 @@\n-first\n-second\n context";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -1,3 +1,1 @@\n-L1:first\n-L2:second\n L1:context");
  });

  it("does not increment the old-line counter for added lines", () => {
    const patch = "@@ -1,1 +1,3 @@\n+first\n+second\n context";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -1,1 +1,3 @@\n+L1:first\n+L2:second\n L3:context");
  });

  it("increments both counters for context lines", () => {
    const patch = "@@ -5,2 +5,2 @@\n one\n two";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -5,2 +5,2 @@\n L5:one\n L6:two");
  });

  it("resets counters on each hunk header", () => {
    const patch = "@@ -1,1 +1,1 @@\n first\n@@ -10,1 +12,1 @@\n second";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -1,1 +1,1 @@\n L1:first\n@@ -10,1 +12,1 @@\n L12:second");
  });

  it("preserves a hunk header with trailing context text verbatim", () => {
    const patch = "@@ -10,2 +10,2 @@ function foo() {\n body";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -10,2 +10,2 @@ function foo() {\n L10:body");
  });

  it("supports a hunk header without a count suffix", () => {
    const patch = "@@ -1 +1 @@\n line";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -1 +1 @@\n L1:line");
  });

  it("passes through a no-newline marker unchanged", () => {
    const patch = "@@ -1,1 +1,1 @@\n+last line\n\\ No newline at end of file";
    const result = annotatePatch(patch);
    expect(result).toBe("@@ -1,1 +1,1 @@\n+L1:last line\n\\ No newline at end of file");
  });

  it("returns an empty string for an empty patch", () => {
    expect(annotatePatch("")).toBe("");
  });

  it("produces identical output regardless of a trailing newline", () => {
    const withoutTrailing = annotatePatch("@@ -1,1 +1,1 @@\n line");
    const withTrailing = annotatePatch("@@ -1,1 +1,1 @@\n line\n");
    expect(withTrailing).toBe(withoutTrailing);
  });

  it("normalizes CRLF line endings the same as LF", () => {
    const lf = annotatePatch("@@ -1,2 +1,2 @@\n one\n two");
    const crlf = annotatePatch("@@ -1,2 +1,2 @@\r\n one\r\n two");
    expect(crlf).toBe(lf);
  });
});

describe("buildPrompt", () => {
  function context(overrides: Partial<PRInfoResult> = {}): ReviewContext {
    return { prInfo: makePrInfo(overrides) };
  }

  it("includes the repository, PR, and dependency file information", () => {
    const prompt = buildPrompt(context());
    expect(prompt).toContain("Repository: octocat/hello");
    expect(prompt).toContain("Project summary: A demo repo");
    expect(prompt).toContain("PR #42: Add feature");
    expect(prompt).toContain("Body: Some body");
    expect(prompt).toContain("Labels: bug, priority");
    expect(prompt).toContain("Dependency files: package.json");
  });

  it("falls back to (none) for a missing body, empty labels, and empty dependency files", () => {
    const prompt = buildPrompt(
      context({
        prInfo: {
          title: "Add feature",
          prNumber: 42,
          body: null,
          labels: [],
          fileChanges: [],
        },
        dependencyFiles: [],
      }),
    );
    expect(prompt).toContain("Body: (none)");
    expect(prompt).toContain("Labels: (none)");
    expect(prompt).toContain("Dependency files: (none)");
  });

  it("annotates each file change's patch and lists the file path header", () => {
    const prompt = buildPrompt(context());
    expect(prompt).toContain("--- src/a.ts ---");
    expect(prompt).toContain("-L1:old");
    expect(prompt).toContain("+L1:new");
  });

  it("includes the line-number annotation legend when any patch is present", () => {
    const prompt = buildPrompt(context());
    expect(prompt).toContain("Each diff line is prefixed with its actual file line number:");
    expect(prompt).toContain("When reporting a finding, use the L{N} value as the line number.");
  });

  it("omits the legend and reports unavailable patches when no patch is present", () => {
    const prompt = buildPrompt(
      context({
        prInfo: {
          title: "Add feature",
          prNumber: 42,
          body: "Some body",
          labels: [],
          fileChanges: [{ filePath: "src/b.ts", patch: null }],
        },
      }),
    );
    expect(prompt).not.toContain("Each diff line is prefixed");
    expect(prompt).toContain("--- src/b.ts ---");
    expect(prompt).toContain("(patch unavailable; fetch via GitHub)");
  });

  it("ends with the retrieval-guidance footer", () => {
    const prompt = buildPrompt(context());
    const footer =
      "Only the modified sections are provided. Retrieve full files from GitHub as needed.";
    expect(prompt.trimEnd().endsWith(footer)).toBe(true);
  });
});
