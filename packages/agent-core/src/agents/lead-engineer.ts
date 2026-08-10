/**
 * Lead Engineer synthesis stage.
 *
 * Evaluates the aggregated parallel-review output and produces a final
 * accept/reject decision for every finding. Schemas and report-formatting
 * (`toMarkdown`/`toEvaluationFormat`) already live in `models/lead-engineer.ts`
 * (ported in an earlier slice); this module is the execution class only --
 * the direct counterpart of `LLMReviewAgent` for the synthesis stage.
 */

import { Agent } from "@strands-agents/sdk";
import {
  DecisionVerdict,
  type FindingDecision,
  type FindingDecisionOutput,
  FindingImpact,
  FindingPriority,
  type FindingSeverity,
  type LeadEngineerOutput,
  LeadEngineerOutputSchema,
  type LeadEngineerReport,
} from "../models/lead-engineer.js";
import type { ReviewFinding, ReviewPerspective, ReviewReport } from "../models/review.js";
import { ReviewPerspective as ReviewPerspectiveEnum } from "../models/review.js";
import type { ReviewerConfig } from "./base-reviewer.js";
import { StructuredOutputMissingError } from "./exceptions.js";
import { createModelProvider } from "./model-provider-factory.js";

const SYSTEM_PROMPT = `\
You are a lead engineer responsible for triaging and prioritising code review
findings raised by a team of specialist reviewers.

Your sole task is to evaluate each finding submitted by the reviewers and
decide whether to accept it (the developer must address it) or reject it
(false positive, out of scope, or too low value to act on).

Decision criteria -- consider all three axes:
1. Severity: How serious is the issue as reported by the reviewer?
2. Impact: What is the consequence of NOT fixing this issue?
3. Priority: How urgent is the fix relative to the PR goal?

Rules -- you MUST follow every rule without exception:
- Base your decisions ONLY on the findings listed in the input.
- Do NOT introduce new issues, add inferred problems, or speculate beyond
  what the reviewers explicitly reported.
- Do NOT reference specific framework names or technology stacks in your
  reasoning unless a reviewer explicitly mentioned them.
- Every Finding in the input MUST receive a decision.
- Return findingIndex as a plain integer matching the Finding # label --
  for "Finding #1" return 1, not "Finding #1" or "1" (a string). It must
  always be a JSON number.
- Assign severity, impactCategory, and finalPriority independently.
- severity must be critical, high, medium, or low.
- impactCategory must be security, correctness, performance, or maintainability.
- finalPriority must be high, medium, or low; it may differ from the reviewer's
  original priority when the overall PR context justifies it.
- Provide a concise reason for each decision and a prose impact assessment.`;

interface IndexEntry {
  reviewerId: string;
  perspective: ReviewPerspective;
  finding: ReviewFinding;
}

/**
 * Build the evaluation prompt and a finding-index map simultaneously.
 *
 * Each finding is assigned a 1-based index (`Finding #N`), numbered
 * consecutively across all reviewers in a single pass, so the LLM can
 * reference it by number without reproducing the full finding object.
 */
export function buildPromptAndIndex(report: ReviewReport): {
  prompt: string;
  indexMap: Map<number, IndexEntry>;
} {
  const lines: string[] = [
    "Below are the findings from the parallel review stage.",
    "Evaluate each finding and produce a FindingDecision.",
    "",
  ];
  const indexMap = new Map<number, IndexEntry>();

  if (report.results.length === 0) {
    lines.push(
      "No reviewer findings were submitted.",
      "",
      "Produce an overallSummary noting the absence of findings " + "and an empty decisions list.",
    );
    return { prompt: lines.join("\n"), indexMap };
  }

  let n = 1;
  for (const result of report.results) {
    lines.push(`=== Reviewer: ${result.reviewerId} (perspective: ${result.perspective}) ===`);
    lines.push(`Reviewer summary: ${result.output.summary}`);
    lines.push("");

    if (result.output.findings.length === 0) {
      lines.push("  (no findings reported by this reviewer)");
      lines.push("");
      continue;
    }

    for (const finding of result.output.findings) {
      indexMap.set(n, { reviewerId: result.reviewerId, perspective: result.perspective, finding });
      lines.push(`Finding #${n}`);
      lines.push(`  reviewerId: ${result.reviewerId}`);
      lines.push(`  perspective: ${result.perspective}`);
      if (finding.filePath) {
        lines.push(`  file: ${finding.filePath}`);
      }
      if (finding.line) {
        lines.push(`  line: ${finding.line}`);
      }
      lines.push(`  priority: ${finding.priority}`);
      lines.push(`  comment: ${finding.comment}`);
      if (finding.context) {
        lines.push(`  context: ${finding.context}`);
      }
      if (finding.proposedFix) {
        lines.push(`  proposedFix: ${finding.proposedFix}`);
      }
      lines.push("");
      n += 1;
    }
  }

  lines.push(
    `Produce exactly ${indexMap.size} FindingDecision(s) -- one per ` +
      "Finding listed above. Do NOT add decisions for findings not listed.",
  );
  return { prompt: lines.join("\n"), indexMap };
}

/**
 * Resolve LLM output indexes to original findings.
 *
 * Guarantees exactly one decision per finding in `indexMap`: unknown indexes
 * are logged and skipped, duplicate indexes keep only the first occurrence,
 * and a finding the LLM never covered gets a deterministic REJECT default
 * derived from the finding's own priority/perspective.
 */
export function resolveDecisions(
  raw: readonly FindingDecisionOutput[],
  indexMap: ReadonlyMap<number, IndexEntry>,
): FindingDecision[] {
  const decisions: FindingDecision[] = [];
  const seen = new Set<number>();

  for (const d of raw) {
    const entry = indexMap.get(d.findingIndex);
    if (entry === undefined) {
      console.warn(`LeadEngineerAgent: unknown findingIndex ${d.findingIndex} -- skipped`);
      continue;
    }
    if (seen.has(d.findingIndex)) {
      console.warn(
        `LeadEngineerAgent: duplicate findingIndex ${d.findingIndex} -- using first occurrence`,
      );
      continue;
    }
    seen.add(d.findingIndex);
    decisions.push({
      reviewerId: entry.reviewerId,
      perspective: entry.perspective,
      finding: entry.finding,
      verdict: d.verdict,
      reason: d.reason,
      impact: d.impact,
      severity: d.severity,
      impactCategory: d.impactCategory,
      finalPriority: d.finalPriority,
    });
  }

  for (const [idx, entry] of indexMap) {
    if (seen.has(idx)) {
      continue;
    }
    console.warn(
      `LeadEngineerAgent: findingIndex ${idx} has no LLM decision -- defaulting to REJECT`,
    );
    decisions.push({
      reviewerId: entry.reviewerId,
      perspective: entry.perspective,
      finding: entry.finding,
      verdict: DecisionVerdict.enum.REJECT,
      reason: "No decision provided by lead engineer.",
      impact: "Unknown -- no evaluation provided.",
      severity: entry.finding.priority as FindingSeverity,
      impactCategory:
        entry.perspective === ReviewPerspectiveEnum.enum.SECURITY
          ? FindingImpact.enum.SECURITY
          : FindingImpact.enum.CORRECTNESS,
      finalPriority:
        entry.finding.priority === "critical"
          ? FindingPriority.enum.HIGH
          : (entry.finding.priority as FindingPriority),
    });
  }

  return decisions;
}

/**
 * Evaluates parallel reviewer outputs and produces final decisions.
 *
 * Does NOT use GitHub MCP tools -- its inputs are entirely derived from the
 * reviewer outputs already collected. `config.githubToken` is present for
 * interface consistency but unused; `config.modelId` selects the LLM.
 */
export class LeadEngineerAgent {
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(private readonly config: ReviewerConfig) {}

  /**
   * Evaluate all reviewer findings and produce a final report.
   *
   * @throws StructuredOutputMissingError when the agent ends its turn
   *   without invoking the forced structured-output tool.
   */
  async evaluate(report: ReviewReport): Promise<LeadEngineerReport> {
    const { prompt, indexMap } = buildPromptAndIndex(report);
    const model = createModelProvider(
      this.config.providerType ?? "openai",
      this.config.modelId ?? "gpt-4o",
      {
        llmBaseUrl: this.config.llmBaseUrl,
        temperature: 0.3,
        maxTokens: this.config.maxTokens,
        frequencyPenalty: this.config.frequencyPenalty,
      },
    );
    const agent = new Agent({ model, systemPrompt: this.systemPrompt, tools: [] });
    const result = await agent.invoke(prompt, {
      structuredOutputSchema: LeadEngineerOutputSchema,
      limits: { turns: this.config.maxAgentTurns ?? 30 },
    });

    if (result.structuredOutput === undefined) {
      throw new StructuredOutputMissingError("LeadEngineerAgent", result.stopReason);
    }

    const output = result.structuredOutput as LeadEngineerOutput;
    const decisions = resolveDecisions(output.decisions, indexMap);
    return {
      overallSummary: output.overallSummary,
      decisions,
      reviewerErrors: report.errors,
    };
  }
}
