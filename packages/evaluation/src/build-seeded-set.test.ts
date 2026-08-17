import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSeededItem,
  buildSeededItemFromFiles,
  countNewLinesBefore,
  type Defect,
  detectIntentionalMarkers,
  type FileChange,
  isDirectExecution,
  loadTargets,
  parseHunkNewStart,
  resolveDefectLine,
  runBuildSeededSet,
  type SeededPrTarget,
  splitHunks,
} from "./build-seeded-set.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "build-seeded-set-"));
  tempDirectories.push(directory);
  return directory;
}

function defect(overrides: Partial<Defect> = {}): Defect {
  return {
    path: "src/a.vue",
    occurrence: 0,
    ruleId: "rule",
    category: "security",
    severity: "high",
    summary: "summary",
    lineOffset: null,
    ...overrides,
  };
}

function target(overrides: Partial<SeededPrTarget> = {}): SeededPrTarget {
  return {
    repository: "kuju63/vue-seeded",
    stack: "vue",
    prNumber: 8,
    defects: [defect()],
    ...overrides,
  };
}

function files(...items: Array<[string, string]>): FileChange[] {
  return items.map(([path, patch]) => ({ path, patch }));
}

function targetPayload(
  repository = "kuju63/vue-seeded",
  stack = "vue",
  prs: unknown[] = [
    {
      pr_number: 8,
      defects: [
        {
          path: "src/a.vue",
          occurrence: 0,
          rule_id: "rule",
          category: "security",
          severity: "high",
          summary: "summary",
        },
      ],
    },
  ],
): Record<string, unknown> {
  return { repository, stack, prs };
}

function writeTargets(directory: string, name: string, payload: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(payload), "utf-8");
  return path;
}

const goodFiles = files([
  "src/a.vue",
  "@@ -1,1 +1,3 @@\n const a = 1;\n+// INTENTIONAL\n+const b = 2;\n",
]);

describe("unified diff helpers", () => {
  it("splits hunks and discards lines before the first header", () => {
    const hunks = splitHunks("discarded\n@@ -1,2 +1,3 @@\n a\n+b\n@@ -10 +11,2 @@ name\n c\n+d\n");

    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.[0]).toBe("@@ -1,2 +1,3 @@");
    expect(hunks[1]?.[0]).toBe("@@ -10 +11,2 @@ name");
    expect(splitHunks("context only")).toEqual([]);
  });

  it("parses the new-file start and falls back for malformed headers", () => {
    expect(parseHunkNewStart("@@ -10,6 +11,11 @@ export class Foo {")).toBe(11);
    expect(parseHunkNewStart("not a header")).toBe(1);
  });

  it("counts context and additions but not removals", () => {
    const hunk = ["@@ -10,3 +11,3 @@", "-old", " context", "+added"];
    expect(countNewLinesBefore(hunk, 3)).toBe(2);
    expect(countNewLinesBefore(hunk, 0)).toBe(0);
  });
});

describe("INTENTIONAL marker handling", () => {
  it("detects plain, HTML, and SEED-suffixed markers only on added lines", () => {
    const patch =
      "@@ -1,4 +1,7 @@\n" +
      " // INTENTIONAL context\n" +
      "+// INTENTIONAL\n" +
      "+const a = 1;\n" +
      "+<!-- INTENTIONAL -->\n" +
      "+<div />\n" +
      "+// INTENTIONAL: SEED-101\n" +
      "+const b = 2;\n";

    expect(detectIntentionalMarkers(patch)).toHaveLength(3);
    expect(detectIntentionalMarkers("@@ -1 +1 @@\n+const a = 1;\n")).toEqual([]);
  });

  it("resolves the first substantive added line after a marker", () => {
    const hit = {
      hunk: [
        "@@ -10,3 +11,5 @@",
        " context",
        "+// INTENTIONAL: SEED-102",
        "+// eslint-disable-next-line no-unsanitized/property",
        "+el.innerHTML = raw;",
      ],
      markerIdx: 2,
    };

    expect(resolveDefectLine(hit)).toBe(14);
  });

  it("uses an explicit positive line offset", () => {
    const hit = {
      hunk: [
        "@@ -20,3 +21,5 @@",
        " context",
        "+// INTENTIONAL",
        "+return (",
        "+<div dangerouslySetInnerHTML={{ __html: value }} />",
      ],
      markerIdx: 2,
    };

    expect(resolveDefectLine(hit, 2)).toBe(24);
  });

  it.each([0, -1])("rejects non-positive explicit offset %s", (lineOffset) => {
    const hit = {
      hunk: ["@@ -1 +1,2 @@", "+// INTENTIONAL", "+const bad = true;"],
      markerIdx: 1,
    };

    expect(() => resolveDefectLine(hit, lineOffset)).toThrow("line_offset must be positive");
  });

  it("rejects a missing or non-added resolved defect line", () => {
    expect(() =>
      resolveDefectLine({
        hunk: ["@@ -1 +1 @@", "+// INTENTIONAL"],
        markerIdx: 1,
      }),
    ).toThrow("no defect line");
    expect(() =>
      resolveDefectLine(
        {
          hunk: ["@@ -1 +1 @@", "+// INTENTIONAL", " context"],
          markerIdx: 1,
        },
        1,
      ),
    ).toThrow("outside an added line");
  });
});

describe("loadTargets", () => {
  it("loads and flattens target files with defaults and offsets", () => {
    const directory = makeTempDirectory();
    const vue = writeTargets(directory, "vue.json", targetPayload());
    const react = writeTargets(
      directory,
      "react.json",
      targetPayload("kuju63/react-seeded", "react", [
        {
          pr_number: "9",
          defects: [
            {
              path: "src/a.tsx",
              rule_id: "react_rule",
              category: "correctness",
              severity: "medium",
              summary: "summary",
              line_offset: 2,
            },
          ],
        },
      ]),
    );

    const loaded = loadTargets([vue, react]);

    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.defects[0]).toMatchObject({ occurrence: 0, lineOffset: null });
    expect(loaded[1]).toMatchObject({ stack: "react", prNumber: 9 });
    expect(loaded[1]?.defects[0]?.lineOffset).toBe(2);
  });

  it.each([
    ["non-object JSON", [], "must be an object"],
    ["missing key", { stack: "vue", prs: [] }, "missing required key 'repository'"],
    [
      "non-array prs",
      { repository: "owner/repo", stack: "vue", prs: {} },
      "'prs' must be an array",
    ],
    [
      "non-numeric pr_number",
      targetPayload("owner/repo", "vue", [{ pr_number: "abc", defects: [] }]),
      "invalid pr_number",
    ],
    ["invalid stack", targetPayload("owner/repo", "solid", []), "invalid stack"],
    [
      "missing PR number",
      targetPayload("owner/repo", "vue", [{ defects: [] }]),
      "missing required key 'pr_number'",
    ],
    [
      "no defects",
      targetPayload("owner/repo", "vue", [{ pr_number: 1, defects: [] }]),
      "has no defects",
    ],
    [
      "negative occurrence",
      targetPayload("owner/repo", "vue", [
        {
          pr_number: 1,
          defects: [
            {
              path: "a.vue",
              occurrence: -1,
              rule_id: "r",
              category: "security",
              severity: "high",
              summary: "s",
            },
          ],
        },
      ]),
      "expected a non-negative integer",
    ],
    [
      "invalid category",
      targetPayload("owner/repo", "vue", [
        {
          pr_number: 1,
          defects: [
            {
              path: "a.vue",
              rule_id: "r",
              category: "invalid",
              severity: "high",
              summary: "s",
            },
          ],
        },
      ]),
      "invalid category",
    ],
    [
      "invalid severity",
      targetPayload("owner/repo", "vue", [
        {
          pr_number: 1,
          defects: [
            {
              path: "a.vue",
              rule_id: "r",
              category: "security",
              severity: "invalid",
              summary: "s",
            },
          ],
        },
      ]),
      "invalid severity",
    ],
  ])("rejects %s", (_name, payload, message) => {
    const directory = makeTempDirectory();
    const path = writeTargets(directory, "bad.json", payload);

    expect(() => loadTargets([path])).toThrow(message);
  });
});

describe("Seeded item construction", () => {
  it("builds one item and preserves the REST file_changes shape", () => {
    const item = buildSeededItemFromFiles(target(), goodFiles);

    expect(item).toEqual({
      id: "seeded::kuju63/vue-seeded#8",
      repository: "kuju63/vue-seeded",
      pr_number: 8,
      stack: "vue",
      file_changes: goodFiles,
      must_find: [
        {
          rule_id: "rule",
          category: "security",
          severity: "high",
          path: "src/a.vue",
          line: 3,
          summary: "summary",
        },
      ],
    });
  });

  it("maps multiple markers in the same file by occurrence", () => {
    const item = buildSeededItemFromFiles(
      target({
        defects: [
          defect({ occurrence: 0, ruleId: "first" }),
          defect({ occurrence: 1, ruleId: "second" }),
        ],
      }),
      files([
        "src/a.vue",
        "@@ -1 +1,5 @@\n context\n+// INTENTIONAL\n+const first = 1;\n+// INTENTIONAL\n+const second = 2;\n",
      ]),
    );

    expect(item.must_find.map((entry) => entry.rule_id)).toEqual(["first", "second"]);
    expect(item.must_find.map((entry) => entry.line)).toEqual([3, 5]);
  });

  it("fetches using the repository owner and name", async () => {
    const fetchPrFiles = vi.fn().mockResolvedValue(goodFiles);

    await expect(buildSeededItem(target(), "token", fetchPrFiles)).resolves.toMatchObject({
      id: "seeded::kuju63/vue-seeded#8",
    });
    expect(fetchPrFiles).toHaveBeenCalledWith("kuju63", "vue-seeded", 8, "token");
  });

  it("fails closed when no marker or the marker count disagrees", () => {
    expect(() =>
      buildSeededItemFromFiles(
        target(),
        files(["src/a.vue", "@@ -1 +1,2 @@\n context\n+const value = 1;\n"]),
      ),
    ).toThrow("no INTENTIONAL marker");
    expect(() =>
      buildSeededItemFromFiles(
        target({ defects: [defect(), defect({ occurrence: 1 })] }),
        goodFiles,
      ),
    ).toThrow("found 1 marker");
  });

  it("rejects duplicate metadata and uncovered markers", () => {
    const twoMarkerFiles = files([
      "src/a.vue",
      "@@ -1 +1,5 @@\n context\n+// INTENTIONAL\n+const first = 1;\n+// INTENTIONAL\n+const second = 2;\n",
    ]);
    expect(() =>
      buildSeededItemFromFiles(
        target({ defects: [defect(), defect({ ruleId: "other" })] }),
        twoMarkerFiles,
      ),
    ).toThrow("duplicate defect");
  });

  it("rejects metadata that names a missing marker occurrence", () => {
    expect(() =>
      buildSeededItemFromFiles(
        target({
          defects: [defect({ occurrence: 1 }), defect({ path: "src/missing.vue", occurrence: 0 })],
        }),
        files(
          ["src/a.vue", "@@ -1 +1,3 @@\n context\n+// INTENTIONAL\n+const first = 1;\n"],
          ["src/b.vue", "@@ -1 +1,3 @@\n context\n+// INTENTIONAL\n+const second = 2;\n"],
        ),
      ),
    ).toThrow("no marker at path='src/a.vue' occurrence=1");
  });

  it("excludes markdown through the shared target-file predicate", () => {
    expect(() =>
      buildSeededItemFromFiles(
        target({ defects: [defect({ path: "docs/CHANGELOG.md" })] }),
        files([
          "docs/CHANGELOG.md",
          "@@ -1 +1,3 @@\n # Changelog\n+// INTENTIONAL\n+const evil = eval(value);\n",
        ]),
      ),
    ).toThrow("excluded by isTargetFile");
  });
});

describe("isDirectExecution", () => {
  it("resolves package-bin symlinks before comparing the entrypoint", () => {
    const directory = makeTempDirectory();
    const targetPath = join(directory, "build-seeded-set.js");
    const symlinkPath = join(directory, "build-seeded-set");
    writeFileSync(targetPath, "");
    symlinkSync(targetPath, symlinkPath);

    expect(isDirectExecution(pathToFileURL(targetPath).href, symlinkPath)).toBe(true);
    expect(isDirectExecution(pathToFileURL(targetPath).href, undefined)).toBe(false);
  });
});

describe("runBuildSeededSet", () => {
  it("returns 2 before reading targets when GITHUB_TOKEN is absent", async () => {
    const errors: string[] = [];

    await expect(
      runBuildSeededSet(["--targets", "missing.json"], {
        env: {},
        logError: (message) => errors.push(message),
      }),
    ).resolves.toBe(2);
    expect(errors).toContain("GITHUB_TOKEN is required");
  });

  it("requires output unless marker preview is selected", async () => {
    const directory = makeTempDirectory();
    const path = writeTargets(directory, "targets.json", targetPayload());
    const errors: string[] = [];

    await expect(
      runBuildSeededSet(["--targets", path], {
        env: { GITHUB_TOKEN: "token" },
        logError: (message) => errors.push(message),
      }),
    ).resolves.toBe(2);
    expect(errors).toContain("--output is required unless --print-markers is set");
  });

  it("rejects a non-finite sleep interval", async () => {
    const errors: string[] = [];

    await expect(
      runBuildSeededSet(["--targets", "targets.json", "--sleep", "NaN"], {
        env: { GITHUB_TOKEN: "token" },
        logError: (message) => errors.push(message),
      }),
    ).resolves.toBe(2);
    expect(errors.join("\n")).toContain("sleep must be a finite non-negative number");
  });

  it("supports variadic and repeated --targets values", async () => {
    const directory = makeTempDirectory();
    const vue = writeTargets(directory, "vue.json", targetPayload());
    const react = writeTargets(
      directory,
      "react.json",
      targetPayload("kuju63/react-seeded", "react", [
        {
          pr_number: 9,
          defects: [
            {
              path: "src/a.vue",
              rule_id: "rule",
              category: "security",
              severity: "high",
              summary: "summary",
            },
          ],
        },
      ]),
    );
    const svelte = writeTargets(
      directory,
      "svelte.json",
      targetPayload("kuju63/svelte-seeded", "svelte", [
        {
          pr_number: 10,
          defects: [
            {
              path: "src/a.vue",
              rule_id: "rule",
              category: "security",
              severity: "high",
              summary: "summary",
            },
          ],
        },
      ]),
    );
    const fetchPrFiles = vi.fn().mockResolvedValue(goodFiles);
    const writeJsonlAtomic = vi.fn().mockResolvedValue(undefined);

    await expect(
      runBuildSeededSet(
        [
          "--targets",
          vue,
          react,
          "--targets",
          svelte,
          "--output",
          join(directory, "out.jsonl"),
          "--sleep",
          "0",
        ],
        {
          env: { GITHUB_TOKEN: "token" },
          fetchPrFiles,
          writeJsonlAtomic,
          sleep: vi.fn().mockResolvedValue(undefined),
          logError: vi.fn(),
        },
      ),
    ).resolves.toBe(0);
    expect(fetchPrFiles).toHaveBeenCalledTimes(3);
    expect(writeJsonlAtomic).toHaveBeenCalledWith(
      join(directory, "out.jsonl"),
      expect.arrayContaining([
        expect.objectContaining({ stack: "vue" }),
        expect.objectContaining({ stack: "react" }),
        expect.objectContaining({ stack: "svelte" }),
      ]),
    );
  });

  it("filters stacks without making API calls", async () => {
    const directory = makeTempDirectory();
    const path = writeTargets(directory, "targets.json", targetPayload());
    const fetchPrFiles = vi.fn();
    const output: string[] = [];

    await expect(
      runBuildSeededSet(["--targets", path, "--stacks", "react", "--print-markers"], {
        env: { GITHUB_TOKEN: "token" },
        fetchPrFiles,
        stdout: (line) => output.push(line),
      }),
    ).resolves.toBe(0);
    expect(fetchPrFiles).not.toHaveBeenCalled();
    expect(output).toEqual([]);
  });

  it("filters one PR and prints resolved markers", async () => {
    const directory = makeTempDirectory();
    const path = writeTargets(directory, "targets.json", targetPayload());
    const output: string[] = [];

    await expect(
      runBuildSeededSet(
        ["--targets", path, "--pr", "kuju63/vue-seeded#8", "--print-markers", "--sleep", "0"],
        {
          env: { GITHUB_TOKEN: "token" },
          fetchPrFiles: vi.fn().mockResolvedValue(goodFiles),
          sleep: vi.fn().mockResolvedValue(undefined),
          stdout: (line) => output.push(line),
        },
      ),
    ).resolves.toBe(0);
    expect(output).toEqual(["kuju63/vue-seeded#8:", "  path=src/a.vue occurrence=0 line=3"]);
  });

  it("returns 2 when the PR filter matches no target", async () => {
    const directory = makeTempDirectory();
    const path = writeTargets(directory, "targets.json", targetPayload());
    const errors: string[] = [];

    await expect(
      runBuildSeededSet(["--targets", path, "--pr", "kuju63/missing#1", "--print-markers"], {
        env: { GITHUB_TOKEN: "token" },
        logError: (message) => errors.push(message),
      }),
    ).resolves.toBe(2);
    expect(errors).toContain("no target matches --pr kuju63/missing#1");
  });

  it("does not publish partial output when a later target fails", async () => {
    const directory = makeTempDirectory();
    const path = writeTargets(
      directory,
      "targets.json",
      targetPayload("kuju63/vue-seeded", "vue", [
        {
          pr_number: 8,
          defects: [
            {
              path: "src/a.vue",
              occurrence: 0,
              rule_id: "rule",
              category: "security",
              severity: "high",
              summary: "summary",
            },
          ],
        },
        {
          pr_number: 9,
          defects: [
            {
              path: "src/a.vue",
              occurrence: 0,
              rule_id: "rule",
              category: "security",
              severity: "high",
              summary: "summary",
            },
          ],
        },
      ]),
    );
    const outputPath = join(directory, "out.jsonl");
    const fetchPrFiles = vi
      .fn()
      .mockResolvedValueOnce(goodFiles)
      .mockResolvedValueOnce(files(["src/a.vue", "@@ -1 +1,2 @@\n context\n+const value = 1;\n"]));
    const writeJsonlAtomic = vi.fn();

    await expect(
      runBuildSeededSet(["--targets", path, "--output", outputPath, "--sleep", "0"], {
        env: { GITHUB_TOKEN: "token" },
        fetchPrFiles,
        writeJsonlAtomic,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow("no INTENTIONAL marker");
    expect(writeJsonlAtomic).not.toHaveBeenCalled();
    expect(() => readFileSync(outputPath, "utf-8")).toThrow();
  });

  it("leaves an existing output untouched when delegated publication fails", async () => {
    const directory = makeTempDirectory();
    const path = writeTargets(directory, "targets.json", targetPayload());
    const outputPath = join(directory, "out.jsonl");
    const original = '{"id":"previous-run"}\n';
    writeFileSync(outputPath, original, "utf-8");
    const writeJsonlAtomic = vi.fn().mockRejectedValue(new Error("simulated disk full"));

    await expect(
      runBuildSeededSet(["--targets", path, "--output", outputPath, "--sleep", "0"], {
        env: { GITHUB_TOKEN: "token" },
        fetchPrFiles: vi.fn().mockResolvedValue(goodFiles),
        writeJsonlAtomic,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow("simulated disk full");
    expect(readFileSync(outputPath, "utf-8")).toBe(original);
  });
});
