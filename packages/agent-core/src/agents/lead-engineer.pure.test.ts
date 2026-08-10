import { describe, expect, it, vi } from "vitest";
import type { FindingDecisionOutput } from "../models/lead-engineer.js";
import {
  DecisionVerdict,
  FindingImpact,
  FindingPriority,
  FindingSeverity,
} from "../models/lead-engineer.js";
import type { ReviewFinding, ReviewReport, ReviewResult } from "../models/review.js";
import { ProjectType, ReviewPerspective, ReviewPriority } from "../models/review.js";
import { buildPromptAndIndex, resolveDecisions } from "./lead-engineer.js";

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    filePath: "src/a.ts",
    line: 10,
    comment: "Missing null check",
    context: null,
    proposedFix: null,
    priority: ReviewPriority.enum.HIGH,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    reviewerId: "react-technical",
    perspective: ReviewPerspective.enum.TECHNICAL,
    projectType: ProjectType.enum.REACT_TS,
    output: { summary: "Looks mostly fine", findings: [] },
    ...overrides,
  };
}

describe("buildPromptAndIndex", () => {
  it("numbers findings as Finding #N starting at 1", () => {
    const report: ReviewReport = {
      results: [makeResult({ output: { summary: "s", findings: [makeFinding()] } })],
      errors: [],
    };
    const { prompt } = buildPromptAndIndex(report);
    expect(prompt).toContain("Finding #1");
  });

  it("maps the index to reviewerId, perspective, and the exact finding object", () => {
    const finding = makeFinding();
    const report: ReviewReport = {
      results: [makeResult({ output: { summary: "s", findings: [finding] } })],
      errors: [],
    };
    const { indexMap } = buildPromptAndIndex(report);
    const entry = indexMap.get(1);
    expect(entry?.reviewerId).toBe("react-technical");
    expect(entry?.perspective).toBe(ReviewPerspective.enum.TECHNICAL);
    expect(entry?.finding).toBe(finding);
  });

  it("numbers findings consecutively across multiple reviewers", () => {
    const report: ReviewReport = {
      results: [
        makeResult({
          reviewerId: "reviewer-a",
          output: { summary: "s", findings: [makeFinding()] },
        }),
        makeResult({
          reviewerId: "reviewer-b",
          output: { summary: "s", findings: [makeFinding(), makeFinding()] },
        }),
      ],
      errors: [],
    };
    const { indexMap } = buildPromptAndIndex(report);
    expect([...indexMap.keys()]).toEqual([1, 2, 3]);
    expect(indexMap.get(1)?.reviewerId).toBe("reviewer-a");
    expect(indexMap.get(2)?.reviewerId).toBe("reviewer-b");
    expect(indexMap.get(3)?.reviewerId).toBe("reviewer-b");
  });

  it("returns an empty index map and a non-empty prompt for an empty report", () => {
    const report: ReviewReport = { results: [], errors: [] };
    const { prompt, indexMap } = buildPromptAndIndex(report);
    expect(indexMap.size).toBe(0);
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("No reviewer findings were submitted");
  });

  it("returns an empty index map and a non-empty prompt when a reviewer reports no findings", () => {
    const report: ReviewReport = {
      results: [makeResult({ output: { summary: "s", findings: [] } })],
      errors: [],
    };
    const { prompt, indexMap } = buildPromptAndIndex(report);
    expect(indexMap.size).toBe(0);
    expect(prompt).toContain("(no findings reported by this reviewer)");
  });

  it("includes the file and line when present", () => {
    const report: ReviewReport = {
      results: [
        makeResult({
          output: { summary: "s", findings: [makeFinding({ filePath: "src/b.ts", line: 42 })] },
        }),
      ],
      errors: [],
    };
    const { prompt } = buildPromptAndIndex(report);
    expect(prompt).toContain("file: src/b.ts");
    expect(prompt).toContain("line: 42");
  });

  it("includes context and proposedFix when present", () => {
    const report: ReviewReport = {
      results: [
        makeResult({
          output: {
            summary: "s",
            findings: [makeFinding({ context: "surrounding code", proposedFix: "add a guard" })],
          },
        }),
      ],
      errors: [],
    };
    const { prompt } = buildPromptAndIndex(report);
    expect(prompt).toContain("context: surrounding code");
    expect(prompt).toContain("proposedFix: add a guard");
  });

  it("omits file, line, context, and proposedFix when absent", () => {
    const report: ReviewReport = {
      results: [makeResult({ output: { summary: "s", findings: [makeFinding()] } })],
      errors: [],
    };
    const { prompt } = buildPromptAndIndex(report);
    expect(prompt).not.toContain("context:");
    expect(prompt).not.toContain("proposedFix:");
  });
});

describe("resolveDecisions", () => {
  it("resolves a valid index to the original finding by identity", () => {
    const finding = makeFinding();
    const indexMap = new Map([
      [1, { reviewerId: "r", perspective: ReviewPerspective.enum.TECHNICAL, finding }],
    ]);
    const raw: FindingDecisionOutput[] = [
      {
        findingIndex: 1,
        verdict: DecisionVerdict.enum.ACCEPT,
        reason: "valid",
        impact: "impact",
        severity: FindingSeverity.enum.HIGH,
        impactCategory: FindingImpact.enum.CORRECTNESS,
        finalPriority: FindingPriority.enum.HIGH,
      },
    ];
    const decisions = resolveDecisions(raw, indexMap);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.finding).toBe(finding);
  });

  it("skips an unknown index and still defaults the uncovered finding to REJECT", () => {
    const finding = makeFinding({ priority: ReviewPriority.enum.LOW });
    const indexMap = new Map([
      [1, { reviewerId: "r", perspective: ReviewPerspective.enum.TECHNICAL, finding }],
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw: FindingDecisionOutput[] = [
      {
        findingIndex: 999,
        verdict: DecisionVerdict.enum.ACCEPT,
        reason: "unknown",
        impact: "impact",
        severity: FindingSeverity.enum.HIGH,
        impactCategory: FindingImpact.enum.CORRECTNESS,
        finalPriority: FindingPriority.enum.HIGH,
      },
    ];
    const decisions = resolveDecisions(raw, indexMap);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      verdict: DecisionVerdict.enum.REJECT,
      finalPriority: "low",
    });
    warnSpy.mockRestore();
  });

  it("uses only the first occurrence of a duplicate index", () => {
    const finding = makeFinding();
    const indexMap = new Map([
      [1, { reviewerId: "r", perspective: ReviewPerspective.enum.TECHNICAL, finding }],
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw: FindingDecisionOutput[] = [
      {
        findingIndex: 1,
        verdict: DecisionVerdict.enum.ACCEPT,
        reason: "first occurrence",
        impact: "impact",
        severity: FindingSeverity.enum.HIGH,
        impactCategory: FindingImpact.enum.CORRECTNESS,
        finalPriority: FindingPriority.enum.HIGH,
      },
      {
        findingIndex: 1,
        verdict: DecisionVerdict.enum.REJECT,
        reason: "second occurrence",
        impact: "impact",
        severity: FindingSeverity.enum.LOW,
        impactCategory: FindingImpact.enum.CORRECTNESS,
        finalPriority: FindingPriority.enum.LOW,
      },
    ];
    const decisions = resolveDecisions(raw, indexMap);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe("first occurrence");
    warnSpy.mockRestore();
  });

  it("defaults a missing index to REJECT preserving the original priority", () => {
    const criticalFinding = makeFinding({ priority: ReviewPriority.enum.CRITICAL });
    const lowFinding = makeFinding({ priority: ReviewPriority.enum.LOW });
    const indexMap = new Map([
      [
        1,
        {
          reviewerId: "r",
          perspective: ReviewPerspective.enum.TECHNICAL,
          finding: criticalFinding,
        },
      ],
      [2, { reviewerId: "r", perspective: ReviewPerspective.enum.TECHNICAL, finding: lowFinding }],
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw: FindingDecisionOutput[] = [
      {
        findingIndex: 1,
        verdict: DecisionVerdict.enum.ACCEPT,
        reason: "covered",
        impact: "impact",
        severity: FindingSeverity.enum.CRITICAL,
        impactCategory: FindingImpact.enum.CORRECTNESS,
        finalPriority: FindingPriority.enum.HIGH,
      },
    ];
    const decisions = resolveDecisions(raw, indexMap);
    expect(decisions).toHaveLength(2);
    const defaulted = decisions.find((d) => d.finding === lowFinding);
    expect(defaulted).toMatchObject({
      verdict: DecisionVerdict.enum.REJECT,
      reason: "No decision provided by lead engineer.",
      finalPriority: "low",
    });
    warnSpy.mockRestore();
  });

  it("defaults a missing critical security finding to severity=critical, impactCategory=security, finalPriority=high", () => {
    const finding = makeFinding({ priority: ReviewPriority.enum.CRITICAL });
    const indexMap = new Map([
      [1, { reviewerId: "r", perspective: ReviewPerspective.enum.SECURITY, finding }],
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const decisions = resolveDecisions([], indexMap);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      severity: "critical",
      impactCategory: FindingImpact.enum.SECURITY,
      finalPriority: FindingPriority.enum.HIGH,
    });
    warnSpy.mockRestore();
  });

  it("resolves multiple reviewers to their own reviewerId and perspective", () => {
    const findingA = makeFinding();
    const findingB = makeFinding();
    const indexMap = new Map([
      [
        1,
        {
          reviewerId: "reviewer-a",
          perspective: ReviewPerspective.enum.TECHNICAL,
          finding: findingA,
        },
      ],
      [
        2,
        {
          reviewerId: "reviewer-b",
          perspective: ReviewPerspective.enum.SECURITY,
          finding: findingB,
        },
      ],
    ]);
    const raw: FindingDecisionOutput[] = [1, 2].map((findingIndex) => ({
      findingIndex,
      verdict: DecisionVerdict.enum.ACCEPT,
      reason: "ok",
      impact: "impact",
      severity: FindingSeverity.enum.HIGH,
      impactCategory: FindingImpact.enum.CORRECTNESS,
      finalPriority: FindingPriority.enum.HIGH,
    }));
    const decisions = resolveDecisions(raw, indexMap);
    expect(decisions.find((d) => d.finding === findingA)?.reviewerId).toBe("reviewer-a");
    expect(decisions.find((d) => d.finding === findingB)?.reviewerId).toBe("reviewer-b");
    expect(decisions.find((d) => d.finding === findingB)?.perspective).toBe(
      ReviewPerspective.enum.SECURITY,
    );
  });
});
