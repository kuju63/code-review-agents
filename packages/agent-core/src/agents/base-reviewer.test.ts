import { describe, expect, it } from "vitest";
import {
  annotatePatch,
  composeSystemPrompt,
  STRUCTURED_OUTPUT_DIRECTIVE,
} from "./base-reviewer.js";

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
