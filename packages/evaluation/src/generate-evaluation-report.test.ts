import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildReport,
  type EvaluationScores,
  findingRow,
  generateReport,
  goldHeading,
  loadFailedIds,
  refCell,
  renderItemDetail,
  run,
  sanitizeCell,
  seededHeading,
} from "./generate-evaluation-report.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "generate-evaluation-report-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Row = Record<string, unknown>;

function makeScores(
  overrides: { goldItems?: Row[]; seededItems?: Row[]; goldCounts?: Row; seededCounts?: Row } = {},
): EvaluationScores {
  return {
    gold: {
      issue_recall: 0.5,
      issue_precision: 0.5,
      severity_agreement: 0.5,
      severity_exact_agreement: 0.5,
      severity_within_one_agreement: 1.0,
      impact_exact_agreement: 0.6,
      priority_exact_agreement: 0.4,
      priority_within_one_agreement: 0.8,
      counts: (overrides.goldCounts ?? {
        gold_total: 1,
        gold_matched: 1,
        pred_total_for_gold: 1,
        severity_labeled_pairs: 2,
        impact_labeled_pairs: 5,
        priority_labeled_pairs: 5,
      }) as never,
      items: overrides.goldItems ?? [],
    },
    seeded: {
      must_find_recall: 1.0,
      critical_miss_rate: 0.0,
      counts: (overrides.seededCounts ?? {
        seeded_total: 0,
        seeded_detected: 0,
        seeded_critical_total: 0,
        seeded_critical_missed: 0,
      }) as never,
      items: overrides.seededItems ?? [],
    },
  };
}

function makeGoldItemRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "pr1",
    matched: [],
    missed: [],
    unmatched_agent: [],
    expected_total: 0,
    agent_total: 0,
    ...overrides,
  };
}

function makeRawFinding(overrides: Row = {}): Row {
  return {
    path: "src/a.ts",
    line: 10,
    category: "security",
    severity: "high",
    impact: "security",
    priority: "high",
    summary: "xss via innerHTML",
    ...overrides,
  };
}

describe("sanitizeCell", () => {
  it("collapses newlines and tabs", () => {
    expect(sanitizeCell("line1\nline2\tend")).toBe("line1 line2 end");
  });

  it("escapes the pipe character", () => {
    expect(sanitizeCell("a | b")).toBe("a \\| b");
  });

  it("truncates long text with an ellipsis", () => {
    const text = "x".repeat(200);
    const result = sanitizeCell(text, 10);
    expect(result).toHaveLength(10);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves short text unchanged", () => {
    expect(sanitizeCell("short")).toBe("short");
  });

  it("treats null/undefined as empty string", () => {
    expect(sanitizeCell(null)).toBe("");
    expect(sanitizeCell(undefined)).toBe("");
  });

  it("coerces non-string input", () => {
    expect(sanitizeCell(42)).toBe("42");
  });
});

describe("refCell", () => {
  it("renders a Markdown link when source is present", () => {
    const raw = makeRawFinding({ source: "https://github.com/o/r/pull/1#discussion_r1" });
    expect(refCell(raw)).toBe("[source](https://github.com/o/r/pull/1#discussion_r1)");
  });

  it("renders inline code when rule_id is present", () => {
    const raw = makeRawFinding({ rule_id: "js_eval_injection" });
    expect(refCell(raw)).toBe("`js_eval_injection`");
  });

  it("renders a dash when neither is present", () => {
    expect(refCell(makeRawFinding())).toBe("-");
  });

  it("prioritizes source over rule_id", () => {
    const raw = makeRawFinding({ source: "https://x", rule_id: "rule" });
    expect(refCell(raw)).toBe("[source](https://x)");
  });
});

describe("findingRow", () => {
  it("does not throw on a null summary", () => {
    const raw = makeRawFinding({ summary: null });
    const row = findingRow("❌ 見逃し", raw);
    expect(row).toContain("❌ 見逃し");
  });

  it("escapes a pipe in the path", () => {
    const raw = makeRawFinding({ path: "src/a|b.ts" });
    const row = findingRow("✅ マッチ", raw);
    expect(row).toContain("src/a\\|b.ts");
  });

  it("collapses a newline in category", () => {
    const raw = makeRawFinding({ category: "security\ninjected" });
    const row = findingRow("✅ マッチ", raw);
    expect(row).not.toContain("\n");
  });

  it("escapes a pipe in the source ref", () => {
    const raw = makeRawFinding({ source: "https://example.com/a|b" });
    const row = findingRow("✅ マッチ", raw);
    expect(row).toContain("https://example.com/a\\|b");
  });
});

describe("renderItemDetail", () => {
  it("renders a matched row with a check mark", () => {
    const item = makeGoldItemRow({
      matched: [
        {
          expected: makeRawFinding({ summary: "human said X" }),
          agent: makeRawFinding({ summary: "agent said X" }),
          severity_match: true,
          exact_line: true,
        },
      ],
      expected_total: 1,
      agent_total: 1,
    });
    const text = renderItemDetail(item, "`pr1`", "人間レビュー指摘");
    expect(text).toContain("✅");
    expect(text).toContain("human said X");
  });

  it("renders a missed row with a cross mark", () => {
    const item = makeGoldItemRow({
      missed: [makeRawFinding({ summary: "missed issue" })],
      expected_total: 1,
    });
    const text = renderItemDetail(item, "`pr1`", "人間レビュー指摘");
    expect(text).toContain("❌");
    expect(text).toContain("missed issue");
  });

  it("renders an unmatched-agent row with a plus mark", () => {
    const item = makeGoldItemRow({
      unmatched_agent: [makeRawFinding({ summary: "agent-only issue" })],
      agent_total: 1,
    });
    const text = renderItemDetail(item, "`pr1`", "人間レビュー指摘");
    expect(text).toContain("➕");
    expect(text).toContain("agent-only issue");
    expect(text).toContain("誤検知とは限らない");
  });

  it("renders a placeholder for an empty item", () => {
    const text = renderItemDetail(makeGoldItemRow(), "`pr1`", "人間レビュー指摘");
    expect(text).toContain("findings なし");
  });

  it("reports counts on the summary line", () => {
    const item = makeGoldItemRow({
      matched: [
        {
          expected: makeRawFinding(),
          agent: makeRawFinding(),
          severity_match: true,
          exact_line: true,
        },
      ],
      missed: [makeRawFinding({ path: "src/b.ts" })],
      unmatched_agent: [makeRawFinding({ path: "src/c.ts" })],
      expected_total: 2,
      agent_total: 2,
    });
    const text = renderItemDetail(item, "`pr1`", "人間レビュー指摘");
    expect(text).toContain("人間レビュー指摘: 2 件");
    expect(text).toContain("マッチ: 1 件");
    expect(text).toContain("見逃し: 1 件");
    expect(text).toContain("Agentのみ: 1 件");
  });

  it("uses the heading as-is", () => {
    const text = renderItemDetail(makeGoldItemRow(), "`custom-heading`", "Must-Find");
    expect(text.startsWith("### `custom-heading`")).toBe(true);
  });
});

describe("goldHeading", () => {
  it("includes the title when present", () => {
    const heading = goldHeading("owner/repo#1", { "owner/repo#1": "Fix the bug" });
    expect(heading).toContain("owner/repo#1");
    expect(heading).toContain("Fix the bug");
  });

  it("falls back to the id only when the title is missing", () => {
    expect(goldHeading("owner/repo#1", {})).toBe("`owner/repo#1`");
  });
});

describe("seededHeading", () => {
  it("includes base_source and the Gold title", () => {
    const heading = seededHeading("seeded::owner/repo#1::rule", "owner/repo#1", {
      "owner/repo#1": "Fix the bug",
    });
    expect(heading).toContain("seeded::owner/repo#1::rule");
    expect(heading).toContain("owner/repo#1");
    expect(heading).toContain("Fix the bug");
  });

  it("includes base_source without a title", () => {
    const heading = seededHeading("seeded::owner/repo#1::rule", "owner/repo#1", {});
    expect(heading).toContain("owner/repo#1");
  });

  it("handles a missing base_source gracefully", () => {
    expect(seededHeading("seeded::x::rule", "", {})).toBe("`seeded::x::rule`");
  });
});

describe("buildReport integration", () => {
  function baseKwargs() {
    return [
      makeScores(),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      [],
    ] as const;
  }

  it("keeps the existing sections present", () => {
    const report = buildReport(...baseKwargs());
    for (const header of [
      "## 実行情報",
      "## 対象リポジトリ",
      "## 評価対象 PR",
      "## 評価スコア",
      "## Hard Gate 判定",
    ]) {
      expect(report).toContain(header);
    }
  });

  it("renders matched/missed/unmatched rows in the Gold detail section", () => {
    const goldItems = [
      makeGoldItemRow({
        id: "pr1",
        matched: [
          {
            expected: makeRawFinding({ summary: "found by both" }),
            agent: makeRawFinding({ summary: "found by both (agent)" }),
            severity_match: true,
            exact_line: true,
          },
        ],
        missed: [makeRawFinding({ path: "src/b.ts", summary: "only human" })],
        unmatched_agent: [makeRawFinding({ path: "src/c.ts", summary: "only agent" })],
        expected_total: 2,
        agent_total: 2,
      }),
    ];
    const report = buildReport(
      makeScores({ goldItems }),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      [],
    );
    expect(report).toContain("## Gold Set 詳細（PR ごとの人間レビュー指摘 vs Agent 指摘）");
    expect(report).toContain("found by both");
    expect(report).toContain("only human");
    expect(report).toContain("only agent");
  });

  it("reports all finding-axis metrics with denominators", () => {
    const report = buildReport(...baseKwargs());
    expect(report).toContain("| Severity Exact Agreement | 0.500 (n=2) |");
    expect(report).toContain("| Severity Within-One Agreement | 1.000 (n=2) |");
    expect(report).toContain("| Impact Exact Agreement | 0.600 (n=5) |");
    expect(report).toContain("| Priority Exact Agreement | 0.400 (n=5) |");
    expect(report).toContain("| Priority Within-One Agreement | 0.800 (n=5) |");
  });

  it("includes impact and priority in the detail table", () => {
    const goldItems = [
      makeGoldItemRow({
        id: "pr1",
        missed: [makeRawFinding({ impact: "performance", priority: "medium" })],
        expected_total: 1,
      }),
    ];
    const report = buildReport(
      makeScores({ goldItems }),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      [],
    );
    expect(report).toContain("| Impact | Priority |");
    expect(report).toContain("performance");
    expect(report).toContain("medium");
  });

  it("has no 人間レビュー wording in the Seeded detail section", () => {
    const seededItems = [
      makeGoldItemRow({
        id: "seeded::o/r#1::rule",
        missed: [makeRawFinding({ summary: "injected bug" })],
        expected_total: 1,
      }),
    ];
    const report = buildReport(
      makeScores({ seededItems }),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      [],
    );
    const start = report.indexOf("## Seeded Set 詳細");
    const end = report.indexOf("## Hard Gate 判定");
    expect(report.slice(start, end)).not.toContain("人間レビュー");
  });

  it("uses the Must-Find label in the Seeded section", () => {
    const seededItems = [makeGoldItemRow({ id: "seeded::o/r#1::rule" })];
    const report = buildReport(
      makeScores({ seededItems }),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      [],
    );
    expect(report).toContain("Must-Find:");
  });

  it("cross-references the Gold title via base_source in the Seeded section", () => {
    const scoreSeededItems = [makeGoldItemRow({ id: "seeded::o/r#1::rule" })];
    const rawSeededItems = [{ id: "seeded::o/r#1::rule", base_source: "o/r#1" }];
    const report = buildReport(
      makeScores({ seededItems: scoreSeededItems }),
      [{ id: "o/r#1", repository: "o/r", title: "Fix the bug" }],
      rawSeededItems,
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      [],
    );
    expect(report).toContain("Fix the bug");
  });

  it("renders a placeholder when items are empty", () => {
    const report = buildReport(...baseKwargs());
    expect(report).toContain("該当アイテムなし");
  });

  it("appends the failure section when failed_ids is non-empty", () => {
    const report = buildReport(
      makeScores(),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      ["pr1"],
    );
    expect(report).toContain("## 失敗アイテム");
    expect(report).toContain("`pr1`");
  });

  it("excludes a failed Gold item from the Gold detail section", () => {
    const goldItems = [
      makeGoldItemRow({
        id: "pr1",
        missed: [makeRawFinding({ summary: "should not appear" })],
        expected_total: 1,
      }),
    ];
    const report = buildReport(
      makeScores({ goldItems }),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      ["pr1"],
    );
    const start = report.indexOf("## Gold Set 詳細");
    const end = report.indexOf("## Seeded Set 詳細");
    const section = report.slice(start, end);
    expect(section).not.toContain("should not appear");
    expect(section).toContain("評価失敗のため");
  });

  it("excludes a failed Seeded item from the Seeded detail section", () => {
    const seededItems = [
      makeGoldItemRow({
        id: "seeded::o/r#1::rule",
        missed: [makeRawFinding({ summary: "should not appear" })],
        expected_total: 1,
      }),
    ];
    const report = buildReport(
      makeScores({ seededItems }),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      ["seeded::o/r#1::rule"],
    );
    const start = report.indexOf("## Seeded Set 詳細");
    const end = report.indexOf("## Hard Gate 判定");
    const section = report.slice(start, end);
    expect(section).not.toContain("should not appear");
    expect(section).toContain("評価失敗のため");
  });

  it("does not affect non-failed items for unrelated failed_ids", () => {
    const goldItems = [
      makeGoldItemRow({
        id: "pr1",
        missed: [makeRawFinding({ summary: "still shown" })],
        expected_total: 1,
      }),
    ];
    const report = buildReport(
      makeScores({ goldItems }),
      [{ id: "pr1", repository: "o/r", title: "Fix the bug" }],
      [],
      "abc123",
      "gpt-4o",
      "2026-01-01T00:00:00Z",
      ["other-id"],
    );
    expect(report).toContain("still shown");
    expect(report).not.toContain("評価失敗のため");
  });
});

describe("loadFailedIds", () => {
  it("reads the sidecar next to pred by default", async () => {
    const predPath = join(dir, "agent_predictions.jsonl");
    await writeFile(predPath, "", "utf-8");
    await writeFile(join(dir, "agent_predictions.failed_ids.json"), '["id-1", "id-2"]', "utf-8");

    expect(await loadFailedIds(predPath, undefined)).toEqual(["id-1", "id-2"]);
  });

  it("prefers an explicit failed-ids file over the default sidecar", async () => {
    const predPath = join(dir, "agent_predictions.jsonl");
    await writeFile(predPath, "", "utf-8");
    await writeFile(
      join(dir, "agent_predictions.failed_ids.json"),
      '["should-not-be-used"]',
      "utf-8",
    );
    const explicit = join(dir, "custom_failed_ids.json");
    await writeFile(explicit, '["id-9"]', "utf-8");

    expect(await loadFailedIds(predPath, explicit)).toEqual(["id-9"]);
  });

  it("throws by default when the sidecar is missing", async () => {
    const predPath = join(dir, "agent_predictions.jsonl");
    await writeFile(predPath, "", "utf-8");

    await expect(loadFailedIds(predPath, undefined)).rejects.toThrow();
  });

  it("returns an empty list with allowMissing when the sidecar is missing", async () => {
    const predPath = join(dir, "agent_predictions.jsonl");
    await writeFile(predPath, "", "utf-8");

    expect(await loadFailedIds(predPath, undefined, true)).toEqual([]);
  });

  it("throws when the sidecar is not a JSON array of strings", async () => {
    const predPath = join(dir, "agent_predictions.jsonl");
    await writeFile(predPath, "", "utf-8");
    await writeFile(join(dir, "agent_predictions.failed_ids.json"), "{}", "utf-8");

    await expect(loadFailedIds(predPath, undefined)).rejects.toThrow(/must be a JSON array/);
  });
});

describe("generateReport exit codes", () => {
  async function baseArgs(overrides: Row = {}) {
    const gold = join(dir, "gold.jsonl");
    await writeFile(gold, "", "utf-8");
    const seeded = join(dir, "seeded.jsonl");
    await writeFile(seeded, "", "utf-8");
    return {
      gold,
      seeded,
      pred: join(dir, "pred.jsonl"),
      failedIdsFile: undefined,
      allowMissingFailedIds: false,
      ...overrides,
    };
  }

  it("returns 5 when the failed_ids sidecar is missing", async () => {
    const args = await baseArgs();
    expect(await generateReport(args)).toBe(5);
  });

  it("returns 4 when scoring throws", async () => {
    await writeFile(join(dir, "pred.failed_ids.json"), "[]", "utf-8");
    const args = await baseArgs();
    const exitCode = await generateReport(args, {
      score: async () => {
        throw new Error("boom");
      },
    });
    expect(exitCode).toBe(4);
  });

  it("returns 1 and notifies when failed_ids is present", async () => {
    await writeFile(join(dir, "pred.failed_ids.json"), '["pr1"]', "utf-8");
    const args = await baseArgs();
    let notified = false;
    const exitCode = await generateReport(args, {
      score: async () => makeScores(),
      sendDiscordNotification: async () => {
        notified = true;
      },
    });
    expect(exitCode).toBe(1);
    expect(notified).toBe(true);
  });

  it("returns 0 on a clean success and writes a report file", async () => {
    await writeFile(join(dir, "pred.failed_ids.json"), "[]", "utf-8");
    const args = await baseArgs();
    const exitCode = await generateReport(args, {
      score: async () => makeScores(),
      sendDiscordNotification: async () => undefined,
      now: () => new Date("2026-01-01T00:00:00Z"),
      getCommitHash: async () => "abc123",
    });
    expect(exitCode).toBe(0);
    const reportPath = join(dir, "report_20260101-000000-abc123.md");
    const content = await readFile(reportPath, "utf-8");
    expect(content).toContain("# Agent 性能評価レポート");
  });
});

describe("run (CLI)", () => {
  it("parses flags and forwards to generateReport", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeFile(gold, "", "utf-8");
    const seeded = join(dir, "seeded.jsonl");
    await writeFile(seeded, "", "utf-8");
    const pred = join(dir, "pred.jsonl");
    await writeFile(join(dir, "pred.failed_ids.json"), "[]", "utf-8");

    const exitCode = await run(["--gold", gold, "--seeded", seeded, "--pred", pred], {
      score: async () => makeScores(),
      sendDiscordNotification: async () => undefined,
    });

    expect(exitCode).toBe(0);
  });

  it("returns 2 when a required option is missing", async () => {
    const exitCode = await run(["--gold", "gold.jsonl", "--seeded", "seeded.jsonl"]);
    expect(exitCode).toBe(2);
  });

  it("forwards --allow-missing-failed-ids so a missing sidecar is not fatal", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeFile(gold, "", "utf-8");
    const seeded = join(dir, "seeded.jsonl");
    await writeFile(seeded, "", "utf-8");
    const pred = join(dir, "pred.jsonl");
    // Intentionally no pred.failed_ids.json sidecar.

    const exitCode = await run(
      ["--gold", gold, "--seeded", seeded, "--pred", pred, "--allow-missing-failed-ids"],
      {
        score: async () => makeScores(),
        sendDiscordNotification: async () => undefined,
      },
    );

    expect(exitCode).toBe(0);
  });

  it("forwards --failed-ids-file to load the sidecar from a custom path", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeFile(gold, "", "utf-8");
    const seeded = join(dir, "seeded.jsonl");
    await writeFile(seeded, "", "utf-8");
    const pred = join(dir, "pred.jsonl");
    const customFailedIds = join(dir, "custom.failed_ids.json");
    await writeFile(customFailedIds, "[]", "utf-8");

    const exitCode = await run(
      ["--gold", gold, "--seeded", seeded, "--pred", pred, "--failed-ids-file", customFailedIds],
      {
        score: async () => makeScores(),
        sendDiscordNotification: async () => undefined,
      },
    );

    expect(exitCode).toBe(0);
  });
});
