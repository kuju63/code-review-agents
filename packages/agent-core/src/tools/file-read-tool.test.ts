import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileReadTool } from "./file-read-tool.js";

describe("createFileReadTool", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "file-read-tool-"));
    writeFileSync(join(root, "note.md"), "hello from note.md");
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "deep.md"), "hello from nested/deep.md");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads a file directly under the confined root", async () => {
    const fileRead = createFileReadTool({ root });
    const content = await fileRead.invoke({ path: "note.md" });
    expect(content).toBe("hello from note.md");
  });

  it("reads a file in a nested directory under the confined root", async () => {
    const fileRead = createFileReadTool({ root });
    const content = await fileRead.invoke({ path: "nested/deep.md" });
    expect(content).toBe("hello from nested/deep.md");
  });

  it("rejects a path that traverses outside the confined root", async () => {
    const fileRead = createFileReadTool({ root });
    const result = await fileRead.invoke({ path: "../outside.md" });
    expect(result).toMatch(/outside|not allowed|denied/i);
  });

  it("rejects an absolute path outside the confined root", async () => {
    const fileRead = createFileReadTool({ root });
    const result = await fileRead.invoke({ path: `${sep}etc${sep}passwd` });
    expect(result).toMatch(/outside|not allowed|denied/i);
  });

  it("returns an error string (not a throw) for a missing file", async () => {
    const fileRead = createFileReadTool({ root });
    await expect(fileRead.invoke({ path: "missing.md" })).resolves.toMatch(
      /not found|does not exist/i,
    );
  });

  it("returns an error string for a directory path", async () => {
    const fileRead = createFileReadTool({ root });
    const result = await fileRead.invoke({ path: "nested" });
    expect(result).toMatch(/not a file|directory/i);
  });

  it("returns an error string for a file exceeding the configured size cap", async () => {
    writeFileSync(join(root, "big.md"), "x".repeat(100));
    const fileRead = createFileReadTool({ root, maxBytes: 10 });
    const result = await fileRead.invoke({ path: "big.md" });
    expect(result).toMatch(/too large|size limit|exceeds/i);
  });

  it("defaults to the skills directory when no root is given", async () => {
    const fileRead = createFileReadTool();
    expect(fileRead.name).toBe("file_read");
  });
});
