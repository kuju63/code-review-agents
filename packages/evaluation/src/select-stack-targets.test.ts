import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allocateQuota,
  checkCoverageThresholds,
  dedupeRows,
  filterRows,
  loadTargets,
  parseCsvArg,
  run,
  type StackTarget,
  selectBalanced,
  selectStratified,
  summarize,
} from "./select-stack-targets.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "select-stack-targets-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeRow(overrides: Partial<StackTarget> = {}): StackTarget {
  return {
    repository: "owner/repo",
    pr_number: 1,
    stack: "react",
    repo_type: "application",
    severity: "medium",
    impact: "correctness",
    priority: "medium",
    ...overrides,
  };
}

describe("loadTargets", () => {
  it("loads multiple stack files", async () => {
    const react = join(dir, "react.json");
    const vue = join(dir, "vue.json");
    await writeFile(react, JSON.stringify([makeRow({ pr_number: 1, stack: "react" })]));
    await writeFile(vue, JSON.stringify([makeRow({ pr_number: 2, stack: "vue" })]));

    const rows = await loadTargets([react, vue]);
    expect(rows.map((r) => [r.pr_number, r.stack])).toEqual([
      [1, "react"],
      [2, "vue"],
    ]);
  });

  it("rejects an invalid enum value", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, JSON.stringify([makeRow({ severity: "urgent" })]));

    await expect(loadTargets([path])).rejects.toThrow(/bad\.json\[0\][\s\S]*severity/);
  });

  it("rejects an unknown stack", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, JSON.stringify([makeRow({ stack: "solid" })]));

    await expect(loadTargets([path])).rejects.toThrow(/bad\.json\[0\][\s\S]*stack/);
  });

  it("preserves the missing-field message", async () => {
    const path = join(dir, "bad.json");
    const row: Record<string, unknown> = { ...makeRow() };
    delete row.impact;
    await writeFile(path, JSON.stringify([row]));

    await expect(loadTargets([path])).rejects.toThrow(/missing impact at .*bad\.json\[0\]/);
  });

  it.each([null, "not-a-number", true, 1.5])(
    "qualifies an invalid pr_number (%j) with path and index",
    async (invalidPrNumber) => {
      const path = join(dir, "bad.json");
      const row: Record<string, unknown> = { ...makeRow(), pr_number: invalidPrNumber };
      await writeFile(path, JSON.stringify([row]));

      await expect(loadTargets([path])).rejects.toThrow(/bad\.json\[0\][\s\S]*pr_number/);
    },
  );
});

describe("filterRows and dedupeRows", () => {
  it("filters on stack and all three axes", () => {
    const rows = [
      makeRow({
        pr_number: 1,
        stack: "react",
        severity: "high",
        impact: "security",
        priority: "high",
      }),
      makeRow({
        pr_number: 2,
        stack: "vue",
        severity: "medium",
        impact: "correctness",
        priority: "medium",
      }),
      makeRow({
        pr_number: 3,
        stack: "react",
        severity: "low",
        impact: "security",
        priority: "low",
      }),
    ];
    const selected = filterRows(
      rows,
      new Set(["react"]),
      "medium",
      new Set(["security"]),
      new Set(["high"]),
    );
    expect(selected.map((r) => r.pr_number)).toEqual([1]);
  });

  it("keeps the first occurrence when deduping", () => {
    const rows = [
      makeRow({ repository: "a/b", pr_number: 1, stack: "react" }),
      makeRow({ repository: "a/b", pr_number: 1, stack: "vue" }),
    ];
    expect(dedupeRows(rows)).toEqual([rows[0]]);
  });
});

describe("selectBalanced", () => {
  it("round-robins prioritizing severity then priority", () => {
    const rows = [
      makeRow({ pr_number: 1, stack: "react", severity: "low", priority: "high" }),
      makeRow({ pr_number: 2, stack: "react", severity: "high", priority: "low" }),
      makeRow({ pr_number: 3, stack: "vue", severity: "medium", priority: "medium" }),
    ];
    const selected = selectBalanced(rows, 3);
    expect(selected.map((r) => r.pr_number)).toEqual([2, 3, 1]);
  });
});

describe("allocateQuota", () => {
  it("clamps and redistributes across strata", () => {
    const strata = new Map<string, StackTarget[]>([
      ["application", [makeRow({ pr_number: 1 })]],
      ["ui-library", Array.from({ length: 10 }, (_, i) => makeRow({ pr_number: i + 2 }))],
    ]);
    const quota = allocateQuota(6, ["application", "ui-library"], strata);
    expect(quota).toEqual({ application: 1, "ui-library": 5 });
  });
});

describe("selectStratified", () => {
  it("is balanced by repo_type and deterministic for a given seed", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeRow({ pr_number: i, repo_type: "application", stack: "react" }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeRow({ pr_number: i + 10, repo_type: "ui-library", stack: "vue" }),
      ),
    ];
    const first = selectStratified(rows, 8, 7, true);
    const second = selectStratified(rows, 8, 7, true);

    expect(first.map((r) => r.pr_number)).toEqual(second.map((r) => r.pr_number));
    expect(first.filter((r) => r.repo_type === "application")).toHaveLength(4);
    expect(first.filter((r) => r.repo_type === "ui-library")).toHaveLength(4);
  });

  it("produces a different order for a different seed (sanity check on the PRNG)", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow({ pr_number: i, repo_type: i % 2 === 0 ? "application" : "ui-library" }),
    );
    const a = selectStratified(rows, 10, 1, false).map((r) => r.pr_number);
    const b = selectStratified(rows, 10, 2, false).map((r) => r.pr_number);
    expect(a).not.toEqual(b);
  });
});

describe("summarize and coverage", () => {
  it("summarizes the three axes", () => {
    const rows = [
      makeRow({ severity: "high", impact: "security", priority: "high" }),
      makeRow({
        pr_number: 2,
        stack: "vue",
        repo_type: "ui-library",
        severity: "low",
        impact: "maintainability",
        priority: "low",
      }),
    ];
    const summary = summarize(rows);
    expect(summary.severity_distribution).toEqual({ high: 1, low: 1 });
    expect(summary.impact_distribution).toEqual({ maintainability: 1, security: 1 });
    expect(summary.priority_distribution).toEqual({ high: 1, low: 1 });
  });

  it("warns when the impact ratio is low", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ pr_number: i, impact: "correctness" }),
    );
    const summary = summarize(rows);
    const warnings = checkCoverageThresholds(rows, summary);
    expect(warnings.some((w) => w.includes("impact=security"))).toBe(true);
  });
});

describe("parseCsvArg", () => {
  it("returns an empty set for undefined/empty input", () => {
    expect(parseCsvArg(undefined)).toEqual(new Set());
    expect(parseCsvArg("")).toEqual(new Set());
  });

  it("trims and drops empty values", () => {
    expect(parseCsvArg(" a, b ,,c")).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("run (CLI)", () => {
  it("writes execution targets from multiple inputs and prints a summary", async () => {
    const react = join(dir, "react.json");
    const vue = join(dir, "vue.json");
    const output = join(dir, "out.json");
    await writeFile(
      react,
      JSON.stringify([
        makeRow({
          pr_number: 1,
          stack: "react",
          severity: "high",
          impact: "security",
          priority: "high",
        }),
      ]),
    );
    await writeFile(
      vue,
      JSON.stringify([
        makeRow({
          pr_number: 2,
          stack: "vue",
          severity: "low",
          impact: "maintainability",
          priority: "low",
        }),
      ]),
    );

    const lines: string[] = [];
    const exitCode = await run(
      [
        "--inputs",
        react,
        vue,
        "--output",
        output,
        "--min-severity",
        "medium",
        "--impact",
        "security",
        "--print-summary",
      ],
      { stdout: (line) => lines.push(line) },
    );

    expect(exitCode).toBe(0);
    const written = JSON.parse(await readFile(output, "utf-8"));
    expect(written).toEqual([
      {
        repository: "owner/repo",
        pr_number: 1,
        stack: "react",
        severity: "high",
        impact: "security",
        priority: "high",
      },
    ]);
    const summary = JSON.parse(lines[0] as string);
    expect(summary.total).toBe(1);
  });

  it("selects deterministically by severity/priority rank without --shuffle", async () => {
    const path = join(dir, "input.json");
    const output = join(dir, "out.json");
    await writeFile(
      path,
      JSON.stringify([
        makeRow({ pr_number: 1, severity: "critical", priority: "high" }),
        makeRow({ pr_number: 2, severity: "high", priority: "medium" }),
        makeRow({ pr_number: 3, severity: "low", priority: "low" }),
        makeRow({ pr_number: 4, severity: "low", priority: "low" }),
      ]),
    );

    const exitCode = await run(["--inputs", path, "--output", output, "--limit", "2"]);

    expect(exitCode).toBe(0);
    const written = JSON.parse(await readFile(output, "utf-8"));
    expect(written.map((r: { pr_number: number }) => r.pr_number)).toEqual([1, 2]);
  });

  it("requires --shuffle when --stratify-repo-type is set", async () => {
    const path = join(dir, "input.json");
    await writeFile(path, "[]");

    const exitCode = await run([
      "--inputs",
      path,
      "--output",
      join(dir, "out.json"),
      "--limit",
      "5",
      "--stratify-repo-type",
    ]);

    expect(exitCode).toBe(2);
  });

  it("rejects --limit and --stratify-repo-type without --shuffle even at limit<=0", async () => {
    const path = join(dir, "input.json");
    await writeFile(path, "[]");

    const exitCode = await run([
      "--inputs",
      path,
      "--output",
      join(dir, "out.json"),
      "--shuffle",
      "--stratify-repo-type",
    ]);

    expect(exitCode).toBe(2);
  });

  it("rejects an invalid --impact value", async () => {
    const path = join(dir, "input.json");
    await writeFile(path, "[]");

    const exitCode = await run([
      "--inputs",
      path,
      "--output",
      join(dir, "out.json"),
      "--impact",
      "not-a-real-impact",
    ]);

    expect(exitCode).toBe(2);
  });
});
