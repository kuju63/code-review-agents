import { describe, expect, it, vi } from "vitest";
import {
  acceptedDecisions,
  DecisionVerdict,
  type FindingDecision,
  FindingDecisionOutputSchema,
  FindingDecisionSchema,
  type FindingPriority,
  LeadEngineerOutputSchema,
  LeadEngineerReportSchema,
  rejectedDecisions,
  toEvaluationFormat,
  toMarkdown,
} from "./lead-engineer.js";
import { ReviewErrorSchema, type ReviewPerspective, type ReviewPriority } from "./review.js";

function makeDecision(
  overrides: {
    verdict?: "accept" | "reject";
    priority?: ReviewPriority;
    reviewerId?: string;
    perspective?: ReviewPerspective;
    comment?: string;
    filePath?: string | null;
    line?: number | null;
    proposedFix?: string | null;
  } = {},
): FindingDecision {
  const priority = overrides.priority ?? "medium";
  const finalPriority = priority === "critical" ? "high" : (priority as FindingPriority);
  return FindingDecisionSchema.parse({
    reviewerId: overrides.reviewerId ?? "react-technical",
    perspective: overrides.perspective ?? "technical",
    finding: {
      comment: overrides.comment ?? "Test finding",
      priority,
      filePath: overrides.filePath === undefined ? "src/App.tsx" : overrides.filePath,
      line: overrides.line === undefined ? 10 : overrides.line,
      proposedFix: overrides.proposedFix ?? null,
    },
    verdict: overrides.verdict ?? "accept",
    reason: "reason",
    impact: "impact",
    severity: priority,
    impactCategory: "correctness",
    finalPriority,
  });
}

function makeReport(
  decisions: FindingDecision[] = [],
  errors: Array<ReturnType<typeof ReviewErrorSchema.parse>> = [],
) {
  return LeadEngineerReportSchema.parse({
    overallSummary: "Overall OK.",
    decisions,
    reviewerErrors: errors,
  });
}

describe("DecisionVerdict", () => {
  it("has accept/reject values", () => {
    expect(DecisionVerdict.enum.ACCEPT).toBe("accept");
    expect(DecisionVerdict.enum.REJECT).toBe("reject");
  });
});

describe("FindingDecisionOutputSchema", () => {
  const validAxisPayload = () => ({
    findingIndex: 1,
    verdict: "accept",
    reason: "ok",
    impact: "none",
    severity: "high",
    impactCategory: "correctness",
    finalPriority: "medium",
  });

  it("accepts required fields", () => {
    const output = FindingDecisionOutputSchema.parse({
      findingIndex: 1,
      verdict: "accept",
      reason: "Critical security issue.",
      impact: "Data breach if not fixed.",
      severity: "critical",
      impactCategory: "security",
      finalPriority: "high",
    });
    expect(output.findingIndex).toBe(1);
    expect(output.verdict).toBe("accept");
    expect(output.finalPriority).toBe("high");
  });

  it.each(["severity", "impactCategory", "finalPriority"] as const)("requires %s", (missing) => {
    const payload: Record<string, unknown> = validAxisPayload();
    delete payload[missing];
    expect(() => FindingDecisionOutputSchema.parse(payload)).toThrow();
  });

  it.each([
    ["severity", "unknown"],
    ["impactCategory", "style"],
    ["finalPriority", "critical"],
  ] as const)("rejects an out-of-vocabulary %s", (field, value) => {
    const payload: Record<string, unknown> = validAxisPayload();
    payload[field] = value;
    expect(() => FindingDecisionOutputSchema.parse(payload)).toThrow();
  });
});

describe("LeadEngineerOutputSchema", () => {
  it("accepts required fields", () => {
    const output = LeadEngineerOutputSchema.parse({
      overallSummary: "PR looks generally safe.",
      decisions: [],
    });
    expect(output.overallSummary).toBe("PR looks generally safe.");
    expect(output.decisions).toEqual([]);
  });

  it("defaults decisions to an empty array", () => {
    const output = LeadEngineerOutputSchema.parse({ overallSummary: "ok" });
    expect(output.decisions).toEqual([]);
  });
});

describe("FindingDecisionSchema", () => {
  it("holds the original finding", () => {
    const decision = makeDecision({ comment: "XSS via innerHTML", priority: "high" });
    expect(decision.finding.comment).toBe("XSS via innerHTML");
    expect(decision.reviewerId).toBe("react-technical");
    expect(decision.perspective).toBe("technical");
    expect(decision.verdict).toBe("accept");
  });
});

describe("acceptedDecisions/rejectedDecisions", () => {
  it("sorts accepted findings by severity", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", priority: "low" }),
      makeDecision({ verdict: "accept", priority: "critical" }),
      makeDecision({ verdict: "accept", priority: "medium" }),
      makeDecision({ verdict: "accept", priority: "high" }),
    ]);
    expect(acceptedDecisions(report).map((d) => d.severity)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
    ]);
  });

  it("sorts rejected findings by severity", () => {
    const report = makeReport([
      makeDecision({ verdict: "reject", priority: "low" }),
      makeDecision({ verdict: "reject", priority: "high" }),
    ]);
    const result = rejectedDecisions(report);
    expect(result[0]?.finalPriority).toBe("high");
    expect(result[1]?.finalPriority).toBe("low");
  });

  it("excludes rejected findings from accepted", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", priority: "high" }),
      makeDecision({ verdict: "reject", priority: "critical" }),
    ]);
    expect(acceptedDecisions(report)).toHaveLength(1);
    expect(rejectedDecisions(report)).toHaveLength(1);
  });
});

describe("toMarkdown", () => {
  it("contains the accepted file and comment", () => {
    const report = makeReport([
      makeDecision({
        verdict: "accept",
        priority: "high",
        comment: "XSS issue",
        filePath: "src/App.tsx",
        line: 42,
      }),
    ]);
    const md = toMarkdown(report);
    expect(md).toContain("src/App.tsx");
    expect(md).toContain("XSS issue");
    expect(md).toContain("L42");
  });

  it("shows a location placeholder when the finding has no file path", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", priority: "high", filePath: null, line: null }),
    ]);
    expect(toMarkdown(report)).toContain("(no location)");
  });

  it("shows the file path without a line number when line is absent", () => {
    const report = makeReport([
      makeDecision({
        verdict: "accept",
        priority: "high",
        filePath: "src/App.tsx",
        line: null,
      }),
    ]);
    const md = toMarkdown(report);
    expect(md).toContain("`src/App.tsx`");
    expect(md).not.toMatch(/`src\/App\.tsx`\s*L\d/);
  });

  it("distinguishes all three axes and prose impact", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", priority: "critical", filePath: "src/App.tsx" }),
    ]);
    const md = toMarkdown(report);
    expect(md).toContain("**Severity**: critical");
    expect(md).toContain("**Impact category**: correctness");
    expect(md).toContain("**Priority**: high");
    expect(md).toContain("**Impact if not fixed**: impact");
  });

  it("shows the suggested fix when proposedFix is present", () => {
    const report = makeReport([
      makeDecision({
        verdict: "accept",
        priority: "high",
        comment: "Use sanitize() before rendering",
        filePath: "src/App.tsx",
        line: 42,
        proposedFix: "Replace innerHTML with textContent",
      }),
    ]);
    const md = toMarkdown(report);
    expect(md).toContain("**Suggested fix**");
    expect(md).toContain("Replace innerHTML with textContent");
  });

  it("omits the suggested fix when proposedFix is absent", () => {
    const report = makeReport([
      makeDecision({
        verdict: "accept",
        priority: "high",
        comment: "Missing error handling",
        filePath: "src/App.tsx",
        line: 10,
        proposedFix: null,
      }),
    ]);
    expect(toMarkdown(report)).not.toContain("**Suggested fix**");
  });

  it("puts rejected findings in a details block", () => {
    const report = makeReport([
      makeDecision({ verdict: "reject", priority: "low", comment: "Minor style issue" }),
    ]);
    const md = toMarkdown(report);
    expect(md).toContain("<details>");
    expect(md).toContain("Minor style issue");
  });

  it("appends reviewer errors at the end", () => {
    const report = makeReport(
      [],
      [
        ReviewErrorSchema.parse({
          reviewerId: "spring-technical",
          perspective: "technical",
          message: "Connection timeout",
        }),
      ],
    );
    const md = toMarkdown(report);
    expect(md).toContain("spring-technical");
    expect(md).toContain("Connection timeout");
  });

  it("shows a placeholder when nothing is accepted", () => {
    const md = toMarkdown(makeReport([]));
    expect(md).toContain("_No findings accepted._");
  });
});

describe("toEvaluationFormat", () => {
  it("has the expected top-level keys", () => {
    const result = toEvaluationFormat(makeReport(), "octocat/hello#1");
    expect(result.id).toBe("octocat/hello#1");
    expect(result.agent_findings).toBeDefined();
    expect(result.lead_decisions).toBeDefined();
  });

  it("includes only accepted findings in agent_findings", () => {
    const report = makeReport([
      makeDecision({
        verdict: "accept",
        priority: "high",
        comment: "Accepted finding",
        filePath: "src/A.tsx",
      }),
      makeDecision({
        verdict: "reject",
        priority: "medium",
        comment: "Rejected finding",
        filePath: "src/B.tsx",
      }),
    ]);
    const result = toEvaluationFormat(report, "owner/repo#1");
    const summaries = result.agent_findings.map((f) => f.summary);
    expect(summaries).toContain("Accepted finding");
    expect(summaries).not.toContain("Rejected finding");
  });

  it("keeps the three axes independent", () => {
    const report = makeReport([
      makeDecision({
        verdict: "accept",
        priority: "critical",
        perspective: "security",
        filePath: "src/A.tsx",
      }),
    ]);
    const finding = toEvaluationFormat(report, "owner/repo#1").agent_findings[0];
    expect(finding?.severity).toBe("critical");
    expect(finding?.impact).toBe("correctness");
    expect(finding?.priority).toBe("high");
  });

  it("includes all decisions in lead_decisions", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", filePath: "src/A.tsx" }),
      makeDecision({ verdict: "reject", filePath: "src/B.tsx" }),
    ]);
    const result = toEvaluationFormat(report, "owner/repo#1");
    expect(result.lead_decisions).toHaveLength(2);
    expect(new Set(result.lead_decisions.map((d) => d.decision))).toEqual(
      new Set(["accept", "reject"]),
    );
  });

  it("excludes an empty filePath from agent_findings", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", filePath: "src/Valid.tsx", line: 10 }),
      makeDecision({ verdict: "accept", filePath: "", line: 10 }),
    ]);
    const result = toEvaluationFormat(report, "owner/repo#1");
    expect(result.agent_findings).toHaveLength(1);
    expect(result.agent_findings[0]?.path).toBe("src/Valid.tsx");
  });

  it("excludes a missing line from agent_findings", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", filePath: "src/Valid.tsx", line: 42 }),
      makeDecision({ verdict: "accept", filePath: "src/NoLine.tsx", line: null }),
    ]);
    const result = toEvaluationFormat(report, "owner/repo#1");
    expect(result.agent_findings).toHaveLength(1);
    expect(result.agent_findings[0]?.line).toBe(42);
  });

  it("excludes an empty filePath from lead_decisions", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", filePath: "src/Valid.tsx", line: 10 }),
      makeDecision({ verdict: "reject", filePath: "", line: 10 }),
    ]);
    const result = toEvaluationFormat(report, "owner/repo#1");
    expect(result.lead_decisions).toHaveLength(1);
    expect(result.lead_decisions[0]?.path).toBe("src/Valid.tsx");
  });

  it("excludes a missing line from lead_decisions", () => {
    const report = makeReport([
      makeDecision({ verdict: "accept", filePath: "src/Valid.tsx", line: 5 }),
      makeDecision({ verdict: "reject", filePath: "src/NoLine.tsx", line: null }),
    ]);
    const result = toEvaluationFormat(report, "owner/repo#1");
    expect(result.lead_decisions).toHaveLength(1);
    expect(result.lead_decisions[0]?.line).toBe(5);
  });

  it("logs a warning when an accepted finding is dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = makeReport([
      makeDecision({
        verdict: "accept",
        reviewerId: "react-technical",
        comment: "Missing location finding",
        filePath: null,
        line: null,
      }),
    ]);
    toEvaluationFormat(report, "owner/repo#1");

    const text = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(text).toContain("owner/repo#1");
    expect(text).toContain("react-technical");
    expect(text).toContain("Missing location finding");
    warn.mockRestore();
  });

  it("logs a warning when a rejected lead decision is dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = makeReport([
      makeDecision({
        verdict: "reject",
        reviewerId: "security",
        comment: "Missing location rejected finding",
        filePath: null,
        line: null,
      }),
    ]);
    toEvaluationFormat(report, "owner/repo#1");

    expect(warn).toHaveBeenCalledTimes(1);
    const text = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(text).toContain("owner/repo#1");
    expect(text).toContain("security");
    expect(text).toContain("Missing location rejected finding");
    warn.mockRestore();
  });

  it("logs once per affected output for an accepted finding missing location", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = makeReport([
      makeDecision({
        verdict: "accept",
        comment: "Missing location finding",
        filePath: null,
        line: null,
      }),
    ]);
    const result = toEvaluationFormat(report, "owner/repo#1");

    expect(result.agent_findings).toEqual([]);
    expect(result.lead_decisions).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("does not warn when location is present", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = makeReport([
      makeDecision({ verdict: "accept", filePath: "src/A.tsx", line: 1 }),
    ]);
    toEvaluationFormat(report, "owner/repo#1");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
