#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  createModelProvider,
  ProviderType,
} from "@code-review-agent/agent-core/agents/model-provider-factory.js";
import { Agent } from "@strands-agents/sdk";
import { Command, Option } from "commander";
import { z } from "zod";
import { readJsonl } from "./lib/jsonl.js";

export type SemanticJudge = (goldSummary: string, predSummary: string) => Promise<boolean>;

const SEMANTIC_JUDGE_SYSTEM_PROMPT = `You judge whether two code review findings describe the same underlying defect. Both findings already refer to the same file and a nearby line; decide whether their content -- not their wording, severity label, or category -- points at the same issue.
`;

export const SemanticMatchVerdictSchema = z.object({
  is_match: z.boolean(),
});

export type SemanticMatchVerdict = z.infer<typeof SemanticMatchVerdictSchema>;

export function makeLlmSemanticJudge(
  modelId: string,
  llmBaseUrl?: string,
  providerType: ProviderType = ProviderType.OPENAI,
): SemanticJudge {
  const model = createModelProvider(providerType, modelId, {
    llmBaseUrl,
    temperature: 0.0,
  });

  const agent = new Agent({
    model,
    systemPrompt: SEMANTIC_JUDGE_SYSTEM_PROMPT,
    tools: [],
    printer: false,
  });

  return async (goldSummary: string, predSummary: string): Promise<boolean> => {
    const prompt = `Finding A: ${goldSummary}\nFinding B: ${predSummary}`;
    try {
      const result = await agent.invoke(prompt, {
        structuredOutputSchema: SemanticMatchVerdictSchema,
      });
      if (result.structuredOutput === undefined || result.structuredOutput === null) {
        return false;
      }
      return (result.structuredOutput as SemanticMatchVerdict).is_match;
    } catch (error) {
      console.error("semantic judge call failed; treating as non-match", error);
      return false;
    }
  };
}

export const SEVERITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
export const IMPACTS: ReadonlySet<string> = new Set([
  "security",
  "correctness",
  "performance",
  "maintainability",
]);
export const PRIORITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export interface Finding {
  category: string;
  severity: unknown;
  impact: unknown;
  priority: unknown;
  path: string;
  line: number;
  summary: string;
}

export interface MatchedPair {
  gold: Finding;
  pred: Finding;
  severity_match: boolean;
  severity_exact_match: boolean | null;
  severity_within_one_match: boolean | null;
  impact_exact_match: boolean | null;
  priority_exact_match: boolean | null;
  priority_within_one_match: boolean | null;
  exact_line: boolean;
}

export interface MatchResult {
  pairs: MatchedPair[];
  missedGold: Finding[];
  unmatchedPred: Finding[];
}

type RawFinding = Record<string, unknown>;

function toLine(value: unknown): number {
  if (value === undefined || value === null) {
    return 1;
  }
  const line = Math.trunc(Number(value));
  return Number.isFinite(line) ? line : 1;
}

export function toFindings(items: RawFinding[]): Finding[] {
  return items.map((i) => ({
    category: i.category === undefined ? "unknown" : (i.category as string),
    severity: i.severity === undefined ? "unknown" : i.severity,
    impact: i.impact === undefined ? "unknown" : i.impact,
    priority: i.priority === undefined ? "unknown" : i.priority,
    path: i.path === undefined ? "" : (i.path as string),
    line: toLine(i.line),
    summary: i.summary === undefined ? "" : (i.summary as string),
  }));
}

export async function isMatch(
  a: Finding,
  b: Finding,
  lineTolerance = 5,
  semanticJudge?: SemanticJudge,
): Promise<boolean> {
  if (a.path !== b.path) {
    return false;
  }
  if (Math.abs(a.line - b.line) > lineTolerance) {
    return false;
  }
  if (a.category !== "unknown" && b.category !== "unknown" && a.category !== b.category) {
    return false;
  }
  if (semanticJudge !== undefined && a.summary && b.summary) {
    return semanticJudge(a.summary, b.summary);
  }
  return true;
}

function exactMatch(a: unknown, b: unknown, choices: ReadonlySet<string>): boolean | null {
  if (typeof a !== "string" || typeof b !== "string") {
    return null;
  }
  if (!choices.has(a) || !choices.has(b)) {
    return null;
  }
  return a === b;
}

function withinOneMatch(a: unknown, b: unknown, ranks: Record<string, number>): boolean | null {
  if (typeof a !== "string" || typeof b !== "string") {
    return null;
  }
  if (!(a in ranks) || !(b in ranks)) {
    return null;
  }
  return Math.abs((ranks[a] as number) - (ranks[b] as number)) <= 1;
}

export async function matchFindingsDetailed(
  gold: Finding[],
  pred: Finding[],
  semanticJudge?: SemanticJudge,
): Promise<MatchResult> {
  const pairs: MatchedPair[] = [];
  const missedGold: Finding[] = [];
  const usedPred = new Set<number>();

  for (const g of gold) {
    let hitIndex: number | null = null;
    for (let idx = 0; idx < pred.length; idx += 1) {
      if (usedPred.has(idx)) {
        continue;
      }
      const p = pred[idx] as Finding;
      if (await isMatch(g, p, 5, semanticJudge)) {
        hitIndex = idx;
        break;
      }
    }
    if (hitIndex === null) {
      missedGold.push(g);
      continue;
    }
    usedPred.add(hitIndex);
    const p = pred[hitIndex] as Finding;
    const severityExactMatch = exactMatch(
      g.severity,
      p.severity,
      new Set(Object.keys(SEVERITY_RANK)),
    );
    pairs.push({
      gold: g,
      pred: p,
      severity_match: severityExactMatch === true,
      severity_exact_match: severityExactMatch,
      severity_within_one_match: withinOneMatch(g.severity, p.severity, SEVERITY_RANK),
      impact_exact_match: exactMatch(g.impact, p.impact, IMPACTS),
      priority_exact_match: exactMatch(g.priority, p.priority, new Set(Object.keys(PRIORITY_RANK))),
      priority_within_one_match: withinOneMatch(g.priority, p.priority, PRIORITY_RANK),
      exact_line: g.line === p.line,
    });
  }

  const unmatchedPred = pred.filter((_, idx) => !usedPred.has(idx));
  return { pairs, missedGold, unmatchedPred };
}

export async function matchFindings(
  gold: Finding[],
  pred: Finding[],
  semanticJudge?: SemanticJudge,
): Promise<[number, number, number]> {
  const result = await matchFindingsDetailed(gold, pred, semanticJudge);
  const matched = result.pairs.length;
  const severityMatched = result.pairs.filter((p) => p.severity_match).length;
  const exactLineMatched = result.pairs.filter((p) => p.exact_line).length;
  return [matched, severityMatched, exactLineMatched];
}

export function safeDiv(n: number, d: number): number {
  if (d === 0) {
    return 0.0;
  }
  return n / d;
}

function buildItemDetail(
  itemId: string,
  expected: Finding[],
  rawExpected: RawFinding[],
  predicted: Finding[],
  rawPredicted: RawFinding[],
  result: MatchResult,
): Record<string, unknown> {
  const rawById = new Map<Finding, RawFinding>();
  expected.forEach((f, i) => {
    rawById.set(f, rawExpected[i] as RawFinding);
  });
  predicted.forEach((f, i) => {
    rawById.set(f, rawPredicted[i] as RawFinding);
  });

  const raw = (f: Finding): RawFinding => rawById.get(f) as RawFinding;

  return {
    id: itemId,
    matched: result.pairs.map((pair) => ({
      expected: raw(pair.gold),
      agent: raw(pair.pred),
      severity_match: pair.severity_match,
      severity_exact_match: pair.severity_exact_match,
      severity_within_one_match: pair.severity_within_one_match,
      impact_exact_match: pair.impact_exact_match,
      priority_exact_match: pair.priority_exact_match,
      priority_within_one_match: pair.priority_within_one_match,
      exact_line: pair.exact_line,
    })),
    missed: result.missedGold.map((f) => raw(f)),
    unmatched_agent: result.unmatchedPred.map((f) => raw(f)),
    expected_total: expected.length,
    agent_total: predicted.length,
  };
}

type EvalRow = Record<string, unknown>;
type PredById = Record<string, EvalRow>;

export async function scoreGold(
  goldRows: EvalRow[],
  predById: PredById,
  semanticJudge?: SemanticJudge,
): Promise<Record<string, unknown>> {
  let goldTotal = 0;
  let goldMatched = 0;
  let predTotalForGold = 0;
  let exactLineMatchedTotal = 0;
  let severityLabeled = 0;
  let severityExact = 0;
  let severityWithinOne = 0;
  let impactLabeled = 0;
  let impactExact = 0;
  let priorityLabeled = 0;
  let priorityExact = 0;
  let priorityWithinOne = 0;
  const items: Record<string, unknown>[] = [];

  for (const row of goldRows) {
    const pred = predById[row.id as string] ?? { agent_findings: [] };
    const rawExpected = (row.human_findings as RawFinding[]) ?? [];
    const rawPredicted = (pred.agent_findings as RawFinding[]) ?? [];
    const goldFindings = toFindings(rawExpected);
    const predFindings = toFindings(rawPredicted);

    const result = await matchFindingsDetailed(goldFindings, predFindings, semanticJudge);
    const matched = result.pairs.length;
    const exactLineMatched = result.pairs.filter((p) => p.exact_line).length;

    goldTotal += goldFindings.length;
    goldMatched += matched;
    predTotalForGold += predFindings.length;
    severityLabeled += result.pairs.filter((p) => p.severity_exact_match !== null).length;
    severityExact += result.pairs.filter((p) => p.severity_exact_match === true).length;
    severityWithinOne += result.pairs.filter((p) => p.severity_within_one_match === true).length;
    impactLabeled += result.pairs.filter((p) => p.impact_exact_match !== null).length;
    impactExact += result.pairs.filter((p) => p.impact_exact_match === true).length;
    priorityLabeled += result.pairs.filter((p) => p.priority_exact_match !== null).length;
    priorityExact += result.pairs.filter((p) => p.priority_exact_match === true).length;
    priorityWithinOne += result.pairs.filter((p) => p.priority_within_one_match === true).length;
    exactLineMatchedTotal += exactLineMatched;
    items.push(
      buildItemDetail(
        row.id as string,
        goldFindings,
        rawExpected,
        predFindings,
        rawPredicted,
        result,
      ),
    );
  }

  return {
    issue_recall: safeDiv(goldMatched, goldTotal),
    issue_precision: safeDiv(goldMatched, predTotalForGold),
    severity_agreement: safeDiv(severityExact, severityLabeled),
    severity_exact_agreement: safeDiv(severityExact, severityLabeled),
    severity_within_one_agreement: safeDiv(severityWithinOne, severityLabeled),
    impact_exact_agreement: safeDiv(impactExact, impactLabeled),
    priority_exact_agreement: safeDiv(priorityExact, priorityLabeled),
    priority_within_one_agreement: safeDiv(priorityWithinOne, priorityLabeled),
    location_hit_rate: safeDiv(exactLineMatchedTotal, goldMatched),
    counts: {
      gold_total: goldTotal,
      gold_matched: goldMatched,
      pred_total_for_gold: predTotalForGold,
      location_matched_exact: exactLineMatchedTotal,
      severity_labeled_pairs: severityLabeled,
      severity_exact_matched: severityExact,
      severity_within_one_matched: severityWithinOne,
      impact_labeled_pairs: impactLabeled,
      impact_exact_matched: impactExact,
      priority_labeled_pairs: priorityLabeled,
      priority_exact_matched: priorityExact,
      priority_within_one_matched: priorityWithinOne,
    },
    items,
  };
}

export async function scoreSeeded(
  seededRows: EvalRow[],
  predById: PredById,
  semanticJudge?: SemanticJudge,
): Promise<Record<string, unknown>> {
  const verdicts = new Map<string, Promise<boolean>>();
  const cachedSemanticJudge = semanticJudge
    ? (goldSummary: string, predSummary: string): Promise<boolean> => {
        const key = JSON.stringify([goldSummary, predSummary]);
        const existing = verdicts.get(key);
        if (existing) {
          return existing;
        }
        const verdict = semanticJudge(goldSummary, predSummary);
        verdicts.set(key, verdict);
        return verdict;
      }
    : undefined;
  let seededTotal = 0;
  let seededDetected = 0;
  let seededCriticalTotal = 0;
  let seededCriticalMissed = 0;
  const items: Record<string, unknown>[] = [];

  for (const row of seededRows) {
    const pred = predById[row.id as string] ?? { agent_findings: [] };
    const rawExpected = (row.must_find as RawFinding[]) ?? [];
    const rawPredicted = (pred.agent_findings as RawFinding[]) ?? [];
    const mustFind = toFindings(rawExpected);
    const predFindings = toFindings(rawPredicted);
    const result = await matchFindingsDetailed(mustFind, predFindings, cachedSemanticJudge);
    seededTotal += mustFind.length;
    seededDetected += result.pairs.length;
    items.push(
      buildItemDetail(row.id as string, mustFind, rawExpected, predFindings, rawPredicted, result),
    );

    for (const mf of mustFind) {
      if (mf.severity === "critical") {
        seededCriticalTotal += 1;
        let detected = false;
        for (const p of predFindings) {
          if (await isMatch(mf, p, 5, cachedSemanticJudge)) {
            detected = true;
            break;
          }
        }
        if (!detected) {
          seededCriticalMissed += 1;
        }
      }
    }
  }

  return {
    must_find_recall: safeDiv(seededDetected, seededTotal),
    critical_miss_rate: safeDiv(seededCriticalMissed, seededCriticalTotal),
    counts: {
      seeded_total: seededTotal,
      seeded_detected: seededDetected,
      seeded_critical_total: seededCriticalTotal,
      seeded_critical_missed: seededCriticalMissed,
    },
    items,
  };
}

interface ScoreEvaluationOptions {
  gold: string;
  seeded: string;
  pred: string;
  semanticJudge: boolean;
  modelId: string;
  llmBaseUrl?: string;
  providerType: ProviderType;
}

export async function run(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .description("Score review agent evaluation")
    .requiredOption("--gold <path>")
    .requiredOption("--seeded <path>")
    .requiredOption("--pred <path>", "Predictions JSONL with id + agent_findings")
    .option(
      "--semantic-judge",
      "Enable LLM-as-judge semantic matching of finding summaries on top of the path/line/category rule. Off by default: it adds API calls and non-determinism, which would make the Seeded-set hard release gates (EVALUATION_PLAN.md Section 4) flaky.",
      false,
    )
    .option(
      "--model-id <id>",
      "OpenAI-compatible model id used when --semantic-judge is set",
      "gpt-4o",
    )
    .option(
      "--llm-base-url <url>",
      "Optional OpenAI-compatible base URL used when --semantic-judge is set",
    )
    .addOption(
      new Option("--provider-type <type>", "Backend for --semantic-judge (openai or ollama)")
        .choices(Object.values(ProviderType))
        .default(ProviderType.OPENAI),
    );

  program.parse(argv, { from: "user" });
  const opts = program.opts<ScoreEvaluationOptions>();

  const goldRows = (await readJsonl(opts.gold)) as EvalRow[];
  const seededRows = (await readJsonl(opts.seeded)) as EvalRow[];
  const predRows = (await readJsonl(opts.pred)) as EvalRow[];

  const predById: PredById = {};
  for (const row of predRows) {
    predById[row.id as string] = row;
  }

  const semanticJudge = opts.semanticJudge
    ? makeLlmSemanticJudge(opts.modelId, opts.llmBaseUrl, opts.providerType)
    : undefined;

  const report = {
    gold: await scoreGold(goldRows, predById, semanticJudge),
    seeded: await scoreSeeded(seededRows, predById, semanticJudge),
  };

  console.log(JSON.stringify(report, null, 2));
  return 0;
}

export function isDirectExecution(
  metaUrl: string = import.meta.url,
  entrypoint: string | undefined = process.argv[1],
): boolean {
  return entrypoint !== undefined && metaUrl === pathToFileURL(entrypoint).href;
}

export async function main(): Promise<number> {
  return run(process.argv.slice(2));
}

if (isDirectExecution()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
