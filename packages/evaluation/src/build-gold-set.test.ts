import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGoldItem,
  loadTargets,
  normalizeCategory,
  run,
  type Target,
} from "./build-gold-set.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "build-gold-set-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function target(overrides: Partial<Target> = {}): Target {
  return {
    repository: "owner/repo",
    pr_number: 1,
    stack: "react",
    severity: "critical",
    impact: "security",
    priority: "high",
    ...overrides,
  };
}

function fakeApiGet(prUrl: string) {
  return async (url: string, _token: string): Promise<unknown> => {
    if (url.includes("/pulls/1/comments")) {
      return [
        {
          body: "This can expose user data.",
          path: "src/App.tsx",
          line: 12,
          html_url: "https://github.com/owner/repo/pull/1#discussion_r1",
        },
      ];
    }
    if (url === prUrl) {
      return { title: "PR", body: "", labels: [], html_url: prUrl };
    }
    throw new Error(`unexpected url: ${url}`);
  };
}

describe("loadTargets", () => {
  it("loads the three-axis labels", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          repository: "owner/repo",
          pr_number: 1,
          stack: "react",
          severity: "high",
          impact: "security",
          priority: "medium",
        },
      ]),
    );

    expect(loadTargets(path)).toEqual([
      {
        repository: "owner/repo",
        pr_number: 1,
        stack: "react",
        severity: "high",
        impact: "security",
        priority: "medium",
      },
    ]);
  });

  it("defaults axes to unknown for a legacy target", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([{ repository: "owner/repo", pr_number: 1, stack: "vue" }]),
    );

    const [loaded] = loadTargets(path);
    expect([loaded?.severity, loaded?.impact, loaded?.priority]).toEqual([
      "unknown",
      "unknown",
      "unknown",
    ]);
  });

  it("normalizes axes and replaces invalid values with unknown", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          repository: "owner/repo",
          pr_number: 1,
          stack: "angular",
          severity: " HIGH ",
          impact: null,
          priority: "urgent",
        },
      ]),
    );

    const [loaded] = loadTargets(path);
    expect([loaded?.severity, loaded?.impact, loaded?.priority]).toEqual([
      "high",
      "unknown",
      "unknown",
    ]);
  });

  it("fails closed when stack is missing", async () => {
    const path = join(dir, "targets.json");
    await writeFile(path, JSON.stringify([{ repository: "owner/repo", pr_number: 1 }]));

    expect(() => loadTargets(path)).toThrow(/stack/);
  });

  it("fails closed for an unknown stack value", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([{ repository: "owner/repo", pr_number: 1, stack: "solid" }]),
    );

    expect(() => loadTargets(path)).toThrow(/stack/);
  });

  it("fails closed for a missing/malformed repository", async () => {
    const path = join(dir, "targets.json");
    await writeFile(path, JSON.stringify([{ pr_number: 1, stack: "react" }]));

    expect(() => loadTargets(path)).toThrow(/repository/);
  });

  it("fails closed for a non-integer pr_number", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([{ repository: "owner/repo", pr_number: "not-a-number", stack: "react" }]),
    );

    expect(() => loadTargets(path)).toThrow(/pr_number/);
  });

  it("fails closed for a pr_number below 1", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([{ repository: "owner/repo", pr_number: 0, stack: "react" }]),
    );

    expect(() => loadTargets(path)).toThrow(/pr_number/);
  });
});

describe("normalizeCategory", () => {
  it("returns unknown when no keyword matches", () => {
    expect(normalizeCategory("This can expose user data.")).toBe("unknown");
  });

  it("classifies a security keyword", () => {
    expect(normalizeCategory("possible XSS in the render path")).toBe("security");
  });
});

describe("buildGoldItem", () => {
  it("inherits target axes to every finding", async () => {
    const prUrl = "https://api.github.com/repos/owner/repo/pulls/1";
    const t = target({ severity: "critical", impact: "security", priority: "high" });
    const fetchPrFiles = vi.fn().mockResolvedValue([{ path: "src/App.tsx", patch: "@@ -1 +1 @@" }]);

    const item = await buildGoldItem(t, "token", { apiGet: fakeApiGet(prUrl), fetchPrFiles });

    expect(item.human_findings).toEqual([
      {
        category: "unknown",
        severity: "critical",
        impact: "security",
        priority: "high",
        path: "src/App.tsx",
        line: 12,
        summary: "This can expose user data.",
        source: "https://github.com/owner/repo/pull/1#discussion_r1",
      },
    ]);
  });

  it("carries the target stack to the gold item", async () => {
    const prUrl = "https://api.github.com/repos/owner/repo/pulls/1";
    const t = target({ stack: "vue" });
    const fetchPrFiles = vi.fn().mockResolvedValue([{ path: "src/App.tsx", patch: "@@ -1 +1 @@" }]);

    const item = await buildGoldItem(t, "token", { apiGet: fakeApiGet(prUrl), fetchPrFiles });

    expect(item.stack).toBe("vue");
  });

  it("drops file changes and comments outside production code files", async () => {
    const prUrl = "https://api.github.com/repos/owner/repo/pulls/1";
    const t = target();
    const fetchPrFiles = vi.fn().mockResolvedValue([{ path: "README.md", patch: "@@ -1 +1 @@" }]);

    const item = await buildGoldItem(t, "token", { apiGet: fakeApiGet(prUrl), fetchPrFiles });

    expect(item.file_changes).toEqual([]);
  });

  it("skips malformed (non-record) review comment entries without crashing", async () => {
    const prUrl = "https://api.github.com/repos/owner/repo/pulls/1";
    const t = target();
    const fetchPrFiles = vi.fn().mockResolvedValue([{ path: "src/App.tsx", patch: "@@ -1 +1 @@" }]);
    const apiGet = async (url: string, _token: string): Promise<unknown> => {
      if (url.includes("/pulls/1/comments")) {
        return [
          null,
          "not-a-record",
          {
            body: "valid comment",
            path: "src/App.tsx",
            line: 5,
            html_url: "https://github.com/owner/repo/pull/1#discussion_r1",
          },
        ];
      }
      return { title: "PR", body: "", labels: [], html_url: prUrl };
    };

    const item = await buildGoldItem(t, "token", { apiGet, fetchPrFiles });

    expect(item.human_findings).toHaveLength(1);
    expect(item.human_findings[0]?.summary).toBe("valid comment");
  });
});

describe("run (CLI)", () => {
  it("returns 2 when GITHUB_TOKEN is not set", async () => {
    const path = join(dir, "targets.json");
    await writeFile(path, "[]");
    const output = join(dir, "out.jsonl");

    const exitCode = await run(["--input", path, "--output", output], { env: {} });

    expect(exitCode).toBe(2);
  });

  it("writes only items with file changes and human findings", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          repository: "owner/repo",
          pr_number: 1,
          stack: "react",
          severity: "high",
          impact: "security",
          priority: "high",
        },
      ]),
    );
    const output = join(dir, "out.jsonl");
    const prUrl = "https://api.github.com/repos/owner/repo/pulls/1";
    const fetchPrFiles = vi.fn().mockResolvedValue([{ path: "src/App.tsx", patch: "@@ -1 +1 @@" }]);

    const exitCode = await run(["--input", path, "--output", output, "--sleep", "0"], {
      env: { GITHUB_TOKEN: "token" },
      apiGet: fakeApiGet(prUrl),
      fetchPrFiles,
      sleep: async () => undefined,
    });

    expect(exitCode).toBe(0);
    const rows = (await readFile(output, "utf-8"))
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("owner/repo#1");
  });

  it("skips items with no target file changes", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          repository: "owner/repo",
          pr_number: 1,
          stack: "react",
          severity: "high",
          impact: "security",
          priority: "high",
        },
      ]),
    );
    const output = join(dir, "out.jsonl");
    const prUrl = "https://api.github.com/repos/owner/repo/pulls/1";
    const fetchPrFiles = vi.fn().mockResolvedValue([]);

    const exitCode = await run(["--input", path, "--output", output, "--sleep", "0"], {
      env: { GITHUB_TOKEN: "token" },
      apiGet: fakeApiGet(prUrl),
      fetchPrFiles,
      sleep: async () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(await readFile(output, "utf-8")).toBe("");
  });

  it("skips a target whose fetch throws, continuing with the rest", async () => {
    const path = join(dir, "targets.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          repository: "owner/repo",
          pr_number: 1,
          stack: "react",
          severity: "high",
          impact: "security",
          priority: "high",
        },
      ]),
    );
    const output = join(dir, "out.jsonl");

    const exitCode = await run(["--input", path, "--output", output, "--sleep", "0"], {
      env: { GITHUB_TOKEN: "token" },
      apiGet: async () => {
        throw new Error("boom");
      },
      fetchPrFiles: vi.fn().mockResolvedValue([]),
      sleep: async () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(await readFile(output, "utf-8")).toBe("");
  });
});
