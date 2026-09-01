import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding, SemanticJudge } from "./score-evaluation.js";

const { mockAgentCtor, mockCreateModelProvider, mockInvoke, mockReadJsonl } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockAgentCtor = vi.fn(function (this: unknown, config: unknown) {
    return { config, invoke: mockInvoke };
  });
  return {
    mockAgentCtor,
    mockCreateModelProvider: vi.fn().mockReturnValue({ model: true }),
    mockInvoke,
    mockReadJsonl: vi.fn(),
  };
});

vi.mock("@strands-agents/sdk", () => ({ Agent: mockAgentCtor }));
vi.mock("@code-review-agent/agent-core/agents/model-provider-factory.js", () => ({
  createModelProvider: mockCreateModelProvider,
  ProviderType: { OPENAI: "openai", OLLAMA: "ollama" },
}));
vi.mock("./lib/jsonl.js", () => ({ readJsonl: mockReadJsonl }));

import {
  isDirectExecution,
  isMatch,
  main,
  makeLlmSemanticJudge,
  matchFindings,
  matchFindingsDetailed,
  run,
  SemanticMatchVerdictSchema,
  safeDiv,
  scoreGold,
  scoreSeeded,
  toFindings,
} from "./score-evaluation.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    category: "security",
    severity: "high",
    impact: "security",
    priority: "high",
    path: "src/a.ts",
    line: 10,
    summary: "xss via innerHTML",
    ...overrides,
  };
}

function rawFinding(overrides: Partial<Finding> = {}): Record<string, unknown> {
  return { ...makeFinding(overrides) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateModelProvider.mockReturnValue({ model: true });
});

describe("toFindings", () => {
  it("applies the Python defaults and converts line to an integer", () => {
    expect(toFindings([{}])).toEqual([
      {
        category: "unknown",
        severity: "unknown",
        impact: "unknown",
        priority: "unknown",
        path: "",
        line: 1,
        summary: "",
      },
    ]);
    expect(toFindings([{ line: "12" }])[0]?.line).toBe(12);
  });

  it.each([null, "invalid", Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to the default line for a non-finite value %s",
    (line) => {
      expect(toFindings([{ line }])[0]?.line).toBe(1);
    },
  );
});

describe("isMatch structural rules", () => {
  it("rejects a different path", async () => {
    await expect(isMatch(makeFinding(), makeFinding({ path: "src/b.ts" }))).resolves.toBe(false);
  });

  it.each([15, 5])("accepts line %i at the tolerance boundary", async (line) => {
    await expect(isMatch(makeFinding({ line: 10 }), makeFinding({ line }))).resolves.toBe(true);
  });

  it.each([16, 4])("rejects line %i outside the tolerance", async (line) => {
    await expect(isMatch(makeFinding({ line: 10 }), makeFinding({ line }))).resolves.toBe(false);
  });

  it("supports a custom line tolerance", async () => {
    await expect(isMatch(makeFinding({ line: 10 }), makeFinding({ line: 12 }), 1)).resolves.toBe(
      false,
    );
  });

  it("rejects a category mismatch when both categories are known", async () => {
    await expect(
      isMatch(makeFinding({ category: "security" }), makeFinding({ category: "performance" })),
    ).resolves.toBe(false);
  });

  it.each([
    ["unknown", "performance"],
    ["security", "unknown"],
  ])("allows category pair %s and %s", async (categoryA, categoryB) => {
    await expect(
      isMatch(makeFinding({ category: categoryA }), makeFinding({ category: categoryB })),
    ).resolves.toBe(true);
  });
});

describe("isMatch semantic judge", () => {
  it("lets the judge reject a structurally matching pair", async () => {
    const judge = vi.fn<SemanticJudge>().mockResolvedValue(false);
    const a = makeFinding({ summary: "missing null check" });
    const b = makeFinding({ summary: "inefficient loop" });
    await expect(isMatch(a, b, 5, judge)).resolves.toBe(false);
    expect(judge).toHaveBeenCalledOnce();
    expect(judge).toHaveBeenCalledWith(a.summary, b.summary);
  });

  it("lets the judge accept a structurally matching pair", async () => {
    const judge = vi.fn<SemanticJudge>().mockResolvedValue(true);
    await expect(isMatch(makeFinding(), makeFinding(), 5, judge)).resolves.toBe(true);
  });

  it.each([
    ["", "some comment"],
    ["some comment", ""],
  ])("skips the judge when either summary is empty", async (summaryA, summaryB) => {
    const judge = vi.fn<SemanticJudge>().mockResolvedValue(false);
    await expect(
      isMatch(makeFinding({ summary: summaryA }), makeFinding({ summary: summaryB }), 5, judge),
    ).resolves.toBe(true);
    expect(judge).not.toHaveBeenCalled();
  });

  it("does not call the judge after a structural rejection", async () => {
    const judge = vi.fn<SemanticJudge>().mockResolvedValue(true);
    await expect(isMatch(makeFinding(), makeFinding({ path: "src/b.ts" }), 5, judge)).resolves.toBe(
      false,
    );
    expect(judge).not.toHaveBeenCalled();
  });
});

describe("matchFindingsDetailed", () => {
  it("produces an exact pair with all agreement flags", async () => {
    const gold = [makeFinding()];
    const pred = [makeFinding()];
    const result = await matchFindingsDetailed(gold, pred);
    expect(result).toEqual({
      pairs: [
        {
          gold: gold[0],
          pred: pred[0],
          severity_match: true,
          severity_exact_match: true,
          severity_within_one_match: true,
          impact_exact_match: true,
          priority_exact_match: true,
          priority_within_one_match: true,
          exact_line: true,
        },
      ],
      missedGold: [],
      unmatchedPred: [],
    });
    expect(result.pairs[0]?.gold).toBe(gold[0]);
    expect(result.pairs[0]?.pred).toBe(pred[0]);
  });

  it("records unmatched findings on each side", async () => {
    const gold = [makeFinding({ path: "src/a.ts" })];
    const pred = [makeFinding({ path: "src/b.ts" })];
    const result = await matchFindingsDetailed(gold, pred);
    expect(result.pairs).toEqual([]);
    expect(result.missedGold).toEqual(gold);
    expect(result.unmatchedPred).toEqual(pred);
  });

  it("records extra predictions", async () => {
    const gold = [makeFinding()];
    const pred = [makeFinding(), makeFinding({ path: "src/b.ts" })];
    const result = await matchFindingsDetailed(gold, pred);
    expect(result.pairs).toHaveLength(1);
    expect(result.unmatchedPred).toEqual([pred[1]]);
  });

  it("marks tolerance-only matches as non-exact lines", async () => {
    const result = await matchFindingsDetailed(
      [makeFinding({ line: 10 })],
      [makeFinding({ line: 13 })],
    );
    expect(result.pairs[0]?.exact_line).toBe(false);
  });

  it("reports axis disagreement without changing pairing", async () => {
    const result = await matchFindingsDetailed(
      [makeFinding({ severity: "critical", impact: "security", priority: "high" })],
      [makeFinding({ severity: "low", impact: "maintainability", priority: "low" })],
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({
      severity_match: false,
      severity_exact_match: false,
      severity_within_one_match: false,
      impact_exact_match: false,
      priority_exact_match: false,
      priority_within_one_match: false,
    });
  });

  it("returns null axis flags for unknown, invalid, or non-string labels", async () => {
    const result = await matchFindingsDetailed(
      [makeFinding({ severity: "unknown", impact: "security", priority: "high" })],
      [makeFinding({ severity: "high", impact: "invalid", priority: null })],
    );
    expect(result.pairs[0]).toMatchObject({
      severity_match: false,
      severity_exact_match: null,
      severity_within_one_match: null,
      impact_exact_match: null,
      priority_exact_match: null,
      priority_within_one_match: null,
    });
  });

  it("greedily consumes each prediction once", async () => {
    const gold = [makeFinding({ line: 10 }), makeFinding({ line: 11 })];
    const pred = [makeFinding({ line: 10 })];
    const result = await matchFindingsDetailed(gold, pred);
    expect(result.pairs).toHaveLength(1);
    expect(result.missedGold).toEqual([gold[1]]);
    expect(result.unmatchedPred).toEqual([]);
  });

  it("awaits semantic judgments consistently during greedy matching", async () => {
    const judge = vi.fn<SemanticJudge>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await matchFindingsDetailed(
      [makeFinding()],
      [makeFinding({ summary: "first" }), makeFinding({ summary: "second" })],
      judge,
    );
    expect(result.pairs[0]?.pred.summary).toBe("second");
    expect(result.unmatchedPred[0]?.summary).toBe("first");
  });
});

describe("matchFindings", () => {
  it("counts matched, severity-exact, and exact-line pairs", async () => {
    await expect(matchFindings([makeFinding()], [makeFinding()])).resolves.toEqual([1, 1, 1]);
  });

  it("does not count a tolerance match as an exact line", async () => {
    await expect(
      matchFindings([makeFinding({ line: 10 })], [makeFinding({ line: 13 })]),
    ).resolves.toEqual([1, 1, 0]);
  });

  it("excludes unknown severity from severity matched", async () => {
    await expect(
      matchFindings([makeFinding({ severity: "unknown" })], [makeFinding({ severity: "unknown" })]),
    ).resolves.toEqual([1, 0, 1]);
  });
});

describe("safeDiv", () => {
  it("returns zero for a zero denominator", () => {
    expect(safeDiv(3, 0)).toBe(0);
  });

  it("divides nonzero values", () => {
    expect(safeDiv(1, 2)).toBe(0.5);
  });
});

describe("scoreGold", () => {
  it("reports exact and within-one agreement per axis", async () => {
    const goldRows = [
      {
        id: "pr1",
        human_findings: [
          rawFinding({
            path: "src/a.ts",
            severity: "critical",
            impact: "security",
            priority: "high",
          }),
          rawFinding({
            path: "src/b.ts",
            severity: "high",
            impact: "performance",
            priority: "medium",
          }),
          rawFinding({ path: "src/c.ts", severity: "low", impact: "correctness", priority: "low" }),
        ],
      },
    ];
    const predById = {
      pr1: {
        agent_findings: [
          rawFinding({
            path: "src/a.ts",
            severity: "critical",
            impact: "security",
            priority: "high",
          }),
          rawFinding({
            path: "src/b.ts",
            severity: "medium",
            impact: "maintainability",
            priority: "low",
          }),
          rawFinding({
            path: "src/c.ts",
            severity: "high",
            impact: "correctness",
            priority: "high",
          }),
        ],
      },
    };
    const report = await scoreGold(goldRows, predById);
    expect(report).toMatchObject({
      issue_recall: 1,
      issue_precision: 1,
      severity_agreement: 1 / 3,
      severity_exact_agreement: 1 / 3,
      severity_within_one_agreement: 2 / 3,
      impact_exact_agreement: 2 / 3,
      priority_exact_agreement: 1 / 3,
      priority_within_one_agreement: 2 / 3,
      location_hit_rate: 1,
      counts: {
        gold_total: 3,
        gold_matched: 3,
        pred_total_for_gold: 3,
        location_matched_exact: 3,
        severity_labeled_pairs: 3,
        severity_exact_matched: 1,
        severity_within_one_matched: 2,
        impact_labeled_pairs: 3,
        impact_exact_matched: 2,
        priority_labeled_pairs: 3,
        priority_exact_matched: 1,
        priority_within_one_matched: 2,
      },
    });
  });

  it("excludes unknown and invalid axes from each denominator", async () => {
    const report = await scoreGold(
      [{ id: "pr1", human_findings: [rawFinding({ severity: "unknown" })] }],
      {
        pr1: {
          agent_findings: [rawFinding({ severity: "high", impact: "invalid", priority: null })],
        },
      },
    );
    expect(report.counts).toMatchObject({
      gold_matched: 1,
      severity_labeled_pairs: 0,
      impact_labeled_pairs: 0,
      priority_labeled_pairs: 0,
    });
    expect(report).toMatchObject({
      severity_exact_agreement: 0,
      severity_within_one_agreement: 0,
      impact_exact_agreement: 0,
      priority_exact_agreement: 0,
      priority_within_one_agreement: 0,
    });
  });

  it("computes exact-line location hit rate over matched findings", async () => {
    const report = await scoreGold(
      [
        {
          id: "pr1",
          human_findings: [
            rawFinding({ path: "src/a.ts", line: 10 }),
            rawFinding({ path: "src/b.ts", line: 20 }),
          ],
        },
      ],
      {
        pr1: {
          agent_findings: [
            rawFinding({ path: "src/a.ts", line: 10 }),
            rawFinding({ path: "src/b.ts", line: 23 }),
          ],
        },
      },
    );
    expect(report.location_hit_rate).toBe(0.5);
    expect(report.counts).toMatchObject({ gold_matched: 2, location_matched_exact: 1 });
  });

  it("returns zero metrics when there are no matches or denominators", async () => {
    const report = await scoreGold(
      [{ id: "pr1", human_findings: [rawFinding({ path: "src/a.ts" })] }],
      { pr1: { agent_findings: [rawFinding({ path: "src/other.ts" })] } },
    );
    expect(report).toMatchObject({
      issue_recall: 0,
      issue_precision: 0,
      severity_agreement: 0,
      location_hit_rate: 0,
    });
  });

  it("uses empty predictions for a missing prediction row", async () => {
    const report = await scoreGold([{ id: "pr1", human_findings: [rawFinding()] }], {});
    expect(report.counts).toMatchObject({ gold_total: 1, gold_matched: 0, pred_total_for_gold: 0 });
  });

  it("preserves item order, totals, raw fields, and report JSON shape", async () => {
    const matched = { ...rawFinding({ path: "src/a.ts" }), source: "review-link-1" };
    const missed = { ...rawFinding({ path: "src/b.ts" }), source: "review-link-2" };
    const agent = { ...rawFinding({ path: "src/a.ts" }), extra: "agent-field" };
    const report = await scoreGold(
      [
        { id: "pr1", human_findings: [matched, missed] },
        { id: "pr2", human_findings: [] },
      ],
      { pr1: { agent_findings: [agent] } },
    );
    const items = report.items as Array<Record<string, unknown>>;
    expect(items.map((item) => item.id)).toEqual(["pr1", "pr2"]);
    expect(items[0]).toEqual({
      id: "pr1",
      matched: [
        {
          expected: matched,
          agent,
          severity_match: true,
          severity_exact_match: true,
          severity_within_one_match: true,
          impact_exact_match: true,
          priority_exact_match: true,
          priority_within_one_match: true,
          exact_line: true,
        },
      ],
      missed: [missed],
      unmatched_agent: [],
      expected_total: 2,
      agent_total: 1,
    });
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it("maps structurally duplicate rows by object reference", async () => {
    const first = { ...rawFinding(), source: "first" };
    const second = { ...rawFinding(), source: "second" };
    const agent = rawFinding();
    const report = await scoreGold([{ id: "pr1", human_findings: [first, second] }], {
      pr1: { agent_findings: [agent] },
    });
    const item = (report.items as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    const pairs = item.matched as Array<Record<string, unknown>>;
    expect(pairs[0]?.expected).toBe(first);
    expect(item.missed).toEqual([second]);
  });

  it("awaits the semantic judge while scoring", async () => {
    const judge = vi.fn<SemanticJudge>().mockResolvedValue(false);
    const report = await scoreGold(
      [{ id: "pr1", human_findings: [rawFinding()] }],
      { pr1: { agent_findings: [rawFinding()] } },
      judge,
    );
    expect(report.counts).toMatchObject({ gold_matched: 0 });
  });
});

describe("scoreSeeded", () => {
  it("computes must-find recall and critical miss rate", async () => {
    const report = await scoreSeeded(
      [
        {
          id: "seed1",
          must_find: [
            rawFinding({ path: "src/a.ts", line: 5, severity: "critical" }),
            rawFinding({ path: "src/b.ts", line: 15, severity: "medium" }),
          ],
        },
      ],
      {
        seed1: {
          agent_findings: [rawFinding({ path: "src/a.ts", line: 5, severity: "critical" })],
        },
      },
    );
    expect(report).toMatchObject({
      must_find_recall: 0.5,
      critical_miss_rate: 0,
      counts: {
        seeded_total: 2,
        seeded_detected: 1,
        seeded_critical_total: 1,
        seeded_critical_missed: 0,
      },
    });
  });

  it("uses the full prediction pool for critical misses independently of greedy consumption", async () => {
    const report = await scoreSeeded(
      [
        {
          id: "seed1",
          must_find: [
            rawFinding({ line: 10, severity: "critical" }),
            rawFinding({ line: 11, severity: "critical" }),
          ],
        },
      ],
      { seed1: { agent_findings: [rawFinding({ line: 10, severity: "critical" })] } },
    );
    expect(report.counts).toMatchObject({
      seeded_critical_total: 2,
      seeded_critical_missed: 0,
    });
    expect(report.critical_miss_rate).toBe(0);
    const item = (report.items as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(item.missed).toHaveLength(1);
  });

  it("counts a critical finding as missed when nothing in the full pool matches", async () => {
    const report = await scoreSeeded(
      [{ id: "seed1", must_find: [rawFinding({ severity: "critical" })] }],
      { seed1: { agent_findings: [rawFinding({ path: "src/b.ts" })] } },
    );
    expect(report).toMatchObject({
      must_find_recall: 0,
      critical_miss_rate: 1,
      counts: { seeded_critical_total: 1, seeded_critical_missed: 1 },
    });
  });

  it("preserves rule_id and mirrors the gold item-detail shape", async () => {
    const hit = { ...rawFinding({ severity: "critical" }), rule_id: "hit-rule" };
    const miss = { ...rawFinding({ path: "src/b.ts" }), rule_id: "miss-rule" };
    const agent = rawFinding({ severity: "critical" });
    const report = await scoreSeeded([{ id: "seed1", must_find: [hit, miss] }], {
      seed1: { agent_findings: [agent] },
    });
    const item = (report.items as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(item).toMatchObject({
      id: "seed1",
      expected_total: 2,
      agent_total: 1,
      missed: [miss],
      unmatched_agent: [],
    });
    expect((item.matched as Array<Record<string, unknown>>)[0]?.expected).toBe(hit);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it("uses empty predictions for a missing prediction row", async () => {
    const report = await scoreSeeded(
      [{ id: "seed1", must_find: [rawFinding({ severity: "critical" })] }],
      {},
    );
    expect(report.counts).toMatchObject({ seeded_total: 1, seeded_detected: 0 });
  });

  it("reuses semantic judgment across greedy and full-pool critical checks", async () => {
    const judge = vi.fn<SemanticJudge>().mockResolvedValue(true);
    const report = await scoreSeeded(
      [{ id: "seed1", must_find: [rawFinding({ severity: "critical" })] }],
      { seed1: { agent_findings: [rawFinding()] } },
      judge,
    );
    expect(report.counts).toMatchObject({ seeded_detected: 1, seeded_critical_missed: 0 });
    expect(judge).toHaveBeenCalledTimes(1);
  });
});

describe("makeLlmSemanticJudge", () => {
  it("builds the provider and Agent and returns the structured verdict", async () => {
    mockInvoke.mockResolvedValue({ structuredOutput: { is_match: true } });
    const judge = makeLlmSemanticJudge("gpt-4o", "http://localhost:1234/v1", "ollama");
    await expect(judge("missing null check", "npe risk")).resolves.toBe(true);
    expect(mockCreateModelProvider).toHaveBeenCalledWith("ollama", "gpt-4o", {
      llmBaseUrl: "http://localhost:1234/v1",
      temperature: 0,
    });
    expect(mockAgentCtor).toHaveBeenCalledWith({
      model: { model: true },
      systemPrompt: expect.stringContaining("same underlying defect"),
      tools: [],
      printer: false,
    });
    expect(mockInvoke).toHaveBeenCalledWith("Finding A: missing null check\nFinding B: npe risk", {
      structuredOutputSchema: SemanticMatchVerdictSchema,
    });
  });

  it("defaults to the OpenAI provider", () => {
    makeLlmSemanticJudge("gpt-4o");
    expect(mockCreateModelProvider).toHaveBeenCalledWith("openai", "gpt-4o", {
      llmBaseUrl: undefined,
      temperature: 0,
    });
  });

  it.each([undefined, null])(
    "fails closed when structured output is %s",
    async (structuredOutput) => {
      mockInvoke.mockResolvedValue({ structuredOutput });
      const judge = makeLlmSemanticJudge("gpt-4o");
      await expect(judge("a", "b")).resolves.toBe(false);
    },
  );

  it("fails closed and emits diagnostics to stderr on invocation errors", async () => {
    const error = new Error("upstream timed out");
    mockInvoke.mockRejectedValue(error);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const judge = makeLlmSemanticJudge("gpt-4o");
    await expect(judge("a", "b")).resolves.toBe(false);
    expect(stderr).toHaveBeenCalledWith("semantic judge call failed; treating as non-match", error);
    stderr.mockRestore();
  });
});

describe("run", () => {
  it("reads all JSONL inputs, applies last prediction id wins, and writes only report JSON", async () => {
    mockReadJsonl
      .mockResolvedValueOnce([{ id: "shared", human_findings: [] }])
      .mockResolvedValueOnce([{ id: "shared", must_find: [] }])
      .mockResolvedValueOnce([
        { id: "shared", agent_findings: [rawFinding()] },
        { id: "shared", agent_findings: [] },
      ]);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      run(["--gold", "gold.jsonl", "--seeded", "seeded.jsonl", "--pred", "pred.jsonl"]),
    ).resolves.toBe(0);
    expect(mockReadJsonl.mock.calls).toEqual([["gold.jsonl"], ["seeded.jsonl"], ["pred.jsonl"]]);
    expect(stdout).toHaveBeenCalledOnce();
    const output = stdout.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual({
      gold: expect.objectContaining({
        counts: expect.objectContaining({ pred_total_for_gold: 0 }),
      }),
      seeded: expect.objectContaining({ counts: expect.objectContaining({ seeded_total: 0 }) }),
    });
    expect(stderr).not.toHaveBeenCalled();
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("enables the configured semantic judge", async () => {
    mockReadJsonl
      .mockResolvedValueOnce([{ id: "x", human_findings: [rawFinding()] }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "x", agent_findings: [rawFinding()] }]);
    mockInvoke.mockResolvedValue({ structuredOutput: { is_match: true } });
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await run([
      "--gold",
      "gold.jsonl",
      "--seeded",
      "seeded.jsonl",
      "--pred",
      "pred.jsonl",
      "--semantic-judge",
      "--model-id",
      "judge-model",
      "--llm-base-url",
      "http://localhost:11434",
      "--provider-type",
      "ollama",
    ]);
    expect(mockCreateModelProvider).toHaveBeenCalledWith("ollama", "judge-model", {
      llmBaseUrl: "http://localhost:11434",
      temperature: 0,
    });
    expect(mockInvoke).toHaveBeenCalledOnce();
    stdout.mockRestore();
  });
});

describe("isDirectExecution", () => {
  it("compares the module URL with the entrypoint file URL", () => {
    expect(isDirectExecution("file:///tmp/score.js", "/tmp/score.js")).toBe(true);
    expect(isDirectExecution("file:///tmp/score.js", "/tmp/other.js")).toBe(false);
    expect(isDirectExecution("file:///tmp/score.js", undefined)).toBe(false);
  });
});

describe("main", () => {
  it("delegates using process argv", async () => {
    mockReadJsonl.mockResolvedValue([]);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const argv = process.argv;
    process.argv = ["node", "score-evaluation.js", "--gold", "g", "--seeded", "s", "--pred", "p"];
    try {
      await expect(main()).resolves.toBe(0);
    } finally {
      process.argv = argv;
      stdout.mockRestore();
    }
  });
});
