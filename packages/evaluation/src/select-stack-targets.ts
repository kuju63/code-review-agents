#!/usr/bin/env node
/**
 * Select execution targets from per-stack Gold-set target files.
 *
 * Ported from evaluation/tools/select_stack_targets.py. The `--limit`
 * (deterministic, severity/priority-ranked) selection path never touches
 * randomness and is byte-for-byte equivalent to the Python original --
 * that path is what EVALUATION_PLAN.md §4's release gate uses, so it must
 * stay exact. The `--sample-n`/`--shuffle`/`--stratify-repo-type` path uses
 * a JS-native seeded PRNG (mulberry32 + Fisher-Yates) rather than Python's
 * `random.Random`: given the same seed it is deterministic *within this
 * implementation* (repeated runs agree), but it does not reproduce the
 * same shuffle order as the Python CLI for the same --seed value. That
 * cross-language parity was never required -- only the --limit path is a
 * release-gate signal (see docs handoff notes for this port).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, Option } from "commander";
import { getLogger } from "./lib/logging.js";

const logger = getLogger("select_stack_targets");

export const SEVERITY_SCORE: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const PRIORITY_SCORE: Record<string, number> = { low: 1, medium: 2, high: 3 };
export const PRIORITIES: ReadonlySet<string> = new Set(["low", "medium", "high"]);
export const IMPACTS: ReadonlySet<string> = new Set([
  "security",
  "correctness",
  "performance",
  "maintainability",
]);
const REPO_TYPES: ReadonlySet<string> = new Set(["ui-library", "application"]);
const KNOWN_STACKS: ReadonlySet<string> = new Set(["react", "vue", "angular", "svelte"]);

const DOMAIN_MIN_RATIOS = {
  repo_type_balance_tolerance_pp: 15,
  "stack_within_ui-library": { react: 0.5, vue: 0.3 },
  stack_within_application: { react: 0.4, vue: 0.3, svelte: 0.15, angular: 0.15 },
  impact: { security: 0.4, correctness: 0.3, performance_maintainability: 0.3 },
} as const;

export interface StackTarget {
  repository: string;
  pr_number: number;
  stack: string;
  repo_type: string;
  severity: string;
  impact: string;
  priority: string;
}

function validateChoice(field: string, value: string, choices: ReadonlySet<string>): string {
  if (!choices.has(value)) {
    const allowed = [...choices].sort().join(", ");
    throw new Error(`invalid ${field}=${JSON.stringify(value)}; expected one of: ${allowed}`);
  }
  return value;
}

const REQUIRED_FIELDS = [
  "repository",
  "pr_number",
  "stack",
  "repo_type",
  "severity",
  "impact",
  "priority",
] as const;

/**
 * Load and validate targets from multiple JSON array files.
 *
 * Returns targets in input-file order.
 *
 * Throws when an input is not an array or contains an invalid field.
 */
export async function loadTargets(paths: readonly string[]): Promise<StackTarget[]> {
  const targets: StackTarget[] = [];
  for (const path of paths) {
    const raw = JSON.parse(await readFile(path, "utf-8"));
    if (!Array.isArray(raw)) {
      throw new Error(`input is not a JSON array: ${path}`);
    }
    raw.forEach((item: unknown, index: number) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error(`invalid target at ${path}[${index}]`);
      }
      const record = item as Record<string, unknown>;
      for (const field of REQUIRED_FIELDS) {
        if (!(field in record)) {
          throw new Error(`missing ${field} at ${path}[${index}]`);
        }
      }

      const location = `${path}[${index}]`;
      const rawPrNumber = record.pr_number;
      if (typeof rawPrNumber !== "number" || !Number.isInteger(rawPrNumber)) {
        throw new Error(`invalid target at ${location}: pr_number=${JSON.stringify(rawPrNumber)}`);
      }
      const prNumber = rawPrNumber;

      let repository: string;
      let stack: string;
      let repoType: string;
      let severity: string;
      let impact: string;
      let priority: string;
      try {
        repository = String(record.repository);
        stack = validateChoice("stack", String(record.stack), KNOWN_STACKS);
        repoType = validateChoice("repo_type", String(record.repo_type), REPO_TYPES);
        severity = validateChoice(
          "severity",
          String(record.severity),
          new Set(Object.keys(SEVERITY_SCORE)),
        );
        impact = validateChoice("impact", String(record.impact), IMPACTS);
        priority = validateChoice("priority", String(record.priority), PRIORITIES);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`invalid target at ${location}: ${message}`);
      }
      if (!repository || prNumber < 1) {
        throw new Error(`invalid target identity at ${location}`);
      }
      targets.push({
        repository,
        pr_number: prNumber,
        stack,
        repo_type: repoType,
        severity,
        impact,
        priority,
      });
    });
  }
  return targets;
}

/** Parse a comma-separated CLI argument into trimmed non-empty values. */
export function parseCsvArg(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );
}

/** Filter targets by stack and the three classification axes. */
export function filterRows(
  rows: readonly StackTarget[],
  stacks: ReadonlySet<string>,
  minSeverity: string,
  impacts: ReadonlySet<string>,
  priorities: ReadonlySet<string>,
): StackTarget[] {
  const minimum = SEVERITY_SCORE[minSeverity] as number;
  return rows.filter(
    (row) =>
      (stacks.size === 0 || stacks.has(row.stack)) &&
      (SEVERITY_SCORE[row.severity] as number) >= minimum &&
      (impacts.size === 0 || impacts.has(row.impact)) &&
      (priorities.size === 0 || priorities.has(row.priority)),
  );
}

/** Remove duplicate repository/pull-request pairs, keeping the first occurrence. */
export function dedupeRows(rows: readonly StackTarget[]): StackTarget[] {
  const seen = new Set<string>();
  const result: StackTarget[] = [];
  for (const row of rows) {
    const key = `${row.repository}#${row.pr_number}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(row);
  }
  return result;
}

/** Deterministic severity/priority ordering key (severity dominates). */
function rank(row: StackTarget): number {
  return (SEVERITY_SCORE[row.severity] as number) * 10 + (PRIORITY_SCORE[row.priority] as number);
}

function compareRankDescending(a: StackTarget, b: StackTarget): number {
  return rank(b) - rank(a);
}

/** Select targets round-robin across stacks, at most `limit` results. */
export function selectBalanced(
  rows: readonly StackTarget[],
  limit: number,
  sortByRank = true,
): StackTarget[] {
  const byStack = new Map<string, StackTarget[]>();
  for (const row of rows) {
    const bucket = byStack.get(row.stack);
    if (bucket) {
      bucket.push(row);
    } else {
      byStack.set(row.stack, [row]);
    }
  }
  if (sortByRank) {
    for (const bucket of byStack.values()) {
      bucket.sort(compareRankDescending);
    }
  }

  let stacks = [...byStack.keys()].sort();
  const selected: StackTarget[] = [];
  let index = 0;
  while (selected.length < limit && stacks.length > 0) {
    const stack = stacks[index % stacks.length] as string;
    const bucket = byStack.get(stack) as StackTarget[];
    if (bucket.length > 0) {
      selected.push(bucket.shift() as StackTarget);
    }
    stacks = stacks.filter((name) => (byStack.get(name) as StackTarget[]).length > 0);
    index += 1;
  }
  return selected;
}

/** Split a limit evenly across repo types and redistribute unavailable quota. */
export function allocateQuota(
  limit: number,
  repoTypes: readonly string[],
  strata: ReadonlyMap<string, readonly StackTarget[]>,
): Record<string, number> {
  if (repoTypes.length === 0) {
    return {};
  }
  const ideal: Record<string, number> = {};
  for (const repoType of repoTypes) {
    ideal[repoType] = Math.floor(limit / repoTypes.length);
  }
  const firstRepoType = repoTypes[0] as string;
  ideal[firstRepoType] =
    (ideal[firstRepoType] as number) +
    (limit - repoTypes.reduce((sum, rt) => sum + (ideal[rt] as number), 0));

  const allocated: Record<string, number> = {};
  let shortfall = 0;
  for (const repoType of repoTypes) {
    const available = (strata.get(repoType) ?? []).length;
    allocated[repoType] = Math.min(ideal[repoType] as number, available);
    shortfall += Math.max(0, (ideal[repoType] as number) - available);
  }

  while (shortfall > 0) {
    let progressed = false;
    for (const repoType of repoTypes) {
      const spare = (strata.get(repoType) ?? []).length - (allocated[repoType] as number);
      if (spare <= 0) {
        continue;
      }
      const take = Math.min(spare, shortfall);
      allocated[repoType] = (allocated[repoType] as number) + take;
      shortfall -= take;
      progressed = true;
      if (shortfall === 0) {
        break;
      }
    }
    if (!progressed) {
      break;
    }
  }
  return allocated;
}

/**
 * A small seeded PRNG (mulberry32) plus a Fisher-Yates shuffle. This gives
 * "same seed -> same result" determinism within this TypeScript
 * implementation; it intentionally does not reproduce Python's
 * `random.Random` output for the same seed (see module docstring).
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const temp = array[i] as T;
      array[i] = array[j] as T;
      array[j] = temp;
    }
  }
}

/** Randomly select targets stratified evenly by repository type. */
export function selectStratified(
  rows: readonly StackTarget[],
  limit: number,
  seed: number,
  balanced: boolean,
): StackTarget[] {
  const randomizer = new SeededRandom(seed);
  const strata = new Map<string, StackTarget[]>();
  for (const row of rows) {
    const bucket = strata.get(row.repo_type);
    if (bucket) {
      bucket.push(row);
    } else {
      strata.set(row.repo_type, [row]);
    }
  }
  // Iterate in first-seen (insertion) order, matching Python's
  // defaultdict(list) + dict.values() iteration order.
  for (const bucket of strata.values()) {
    randomizer.shuffle(bucket);
  }

  const repoTypes = [...strata.keys()].sort();
  const quota = allocateQuota(limit, repoTypes, strata);
  const selected: StackTarget[] = [];
  for (const repoType of repoTypes) {
    const bucket = strata.get(repoType) as StackTarget[];
    const count = quota[repoType] as number;
    if (balanced) {
      selected.push(...selectBalanced(bucket, count, false));
    } else {
      selected.push(...bucket.slice(0, count));
    }
  }

  if (selected.length < limit) {
    const selectedKeys = new Set(selected.map((r) => `${r.repository}#${r.pr_number}`));
    const remaining = rows.filter((r) => !selectedKeys.has(`${r.repository}#${r.pr_number}`));
    randomizer.shuffle(remaining);
    selected.push(...remaining.slice(0, limit - selected.length));
  }
  return selected.slice(0, limit);
}

function sortedCount(counts: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) {
    result[key] = counts[key] as number;
  }
  return result;
}

export interface SelectionSummary {
  total: number;
  stack_distribution: Record<string, number>;
  severity_distribution: Record<string, number>;
  impact_distribution: Record<string, number>;
  priority_distribution: Record<string, number>;
  repo_type_distribution: Record<string, number>;
  stack_distribution_by_repo_type: Record<string, Record<string, number>>;
  coverage_warnings: string[];
}

/** Compare selected targets with the evaluation coverage policy. */
export function checkCoverageThresholds(
  rows: readonly StackTarget[],
  summary: Pick<
    SelectionSummary,
    "repo_type_distribution" | "stack_distribution_by_repo_type" | "impact_distribution"
  >,
): string[] {
  const total = rows.length;
  if (total === 0) {
    return [];
  }
  const warnings: string[] = [];
  const tolerance = DOMAIN_MIN_RATIOS.repo_type_balance_tolerance_pp;
  for (const repoType of [...REPO_TYPES].sort()) {
    const ratio = (summary.repo_type_distribution[repoType] ?? 0) / total;
    if (Math.abs(ratio - 0.5) * 100 > tolerance) {
      warnings.push(
        `[COVERAGE-WARN] repo_type=${repoType} ratio=${(ratio * 100).toFixed(1)}% deviates from 50% target beyond tolerance (EVALUATION_PLAN.md §2.0)`,
      );
    }
  }

  const stackPolicy: Record<string, Record<string, number>> = {
    "ui-library": DOMAIN_MIN_RATIOS["stack_within_ui-library"],
    application: DOMAIN_MIN_RATIOS.stack_within_application,
  };
  for (const [repoType, minimums] of Object.entries(stackPolicy)) {
    const bucket = summary.stack_distribution_by_repo_type[repoType] ?? {};
    const bucketTotal = Object.values(bucket).reduce((sum, v) => sum + v, 0);
    if (!bucketTotal) {
      continue;
    }
    for (const [stack, minimum] of Object.entries(minimums)) {
      const actual = (bucket[stack] ?? 0) / bucketTotal;
      if (actual < minimum) {
        warnings.push(
          `[COVERAGE-WARN] ${repoType}/${stack} ratio=${(actual * 100).toFixed(1)}% < min ${(minimum * 100).toFixed(0)}% (EVALUATION_PLAN.md §2.0)`,
        );
      }
    }
  }

  const impactCounts = summary.impact_distribution;
  const impactRatios: Record<string, number> = {
    security: (impactCounts.security ?? 0) / total,
    correctness: (impactCounts.correctness ?? 0) / total,
    performance_maintainability:
      ((impactCounts.performance ?? 0) + (impactCounts.maintainability ?? 0)) / total,
  };
  for (const [impact, minimum] of Object.entries(DOMAIN_MIN_RATIOS.impact)) {
    const actual = impactRatios[impact] as number;
    if (actual < minimum) {
      warnings.push(
        `[COVERAGE-WARN] impact=${impact} ratio=${(actual * 100).toFixed(1)}% < min ${(minimum * 100).toFixed(0)}%`,
      );
    }
  }
  return warnings;
}

/** Build distributions and advisory coverage warnings. */
export function summarize(rows: readonly StackTarget[]): SelectionSummary {
  const stackCount: Record<string, number> = {};
  const severityCount: Record<string, number> = {};
  const impactCount: Record<string, number> = {};
  const priorityCount: Record<string, number> = {};
  const repoTypeCount: Record<string, number> = {};
  const stackByRepoType = new Map<string, Record<string, number>>();

  for (const row of rows) {
    stackCount[row.stack] = (stackCount[row.stack] ?? 0) + 1;
    severityCount[row.severity] = (severityCount[row.severity] ?? 0) + 1;
    impactCount[row.impact] = (impactCount[row.impact] ?? 0) + 1;
    priorityCount[row.priority] = (priorityCount[row.priority] ?? 0) + 1;
    repoTypeCount[row.repo_type] = (repoTypeCount[row.repo_type] ?? 0) + 1;
    const bucket = stackByRepoType.get(row.repo_type) ?? {};
    bucket[row.stack] = (bucket[row.stack] ?? 0) + 1;
    stackByRepoType.set(row.repo_type, bucket);
  }

  const stackDistributionByRepoType: Record<string, Record<string, number>> = {};
  for (const key of [...stackByRepoType.keys()].sort()) {
    stackDistributionByRepoType[key] = sortedCount(
      stackByRepoType.get(key) as Record<string, number>,
    );
  }

  const summary: SelectionSummary = {
    total: rows.length,
    stack_distribution: sortedCount(stackCount),
    severity_distribution: sortedCount(severityCount),
    impact_distribution: sortedCount(impactCount),
    priority_distribution: sortedCount(priorityCount),
    repo_type_distribution: sortedCount(repoTypeCount),
    stack_distribution_by_repo_type: stackDistributionByRepoType,
    coverage_warnings: [],
  };
  summary.coverage_warnings = checkCoverageThresholds(rows, summary);
  return summary;
}

interface ExecutionTarget {
  repository: string;
  pr_number: number;
  stack: string;
  severity: string;
  impact: string;
  priority: string;
}

/**
 * Convert classified targets to the Gold builder input schema, retaining
 * `stack` and finding-axis proxy labels (Issue #181: `stack` must survive
 * through to the Gold and Seeded sets for stack-based reviewer routing).
 */
function toOutput(rows: readonly StackTarget[]): ExecutionTarget[] {
  return rows.map((row) => ({
    repository: row.repository,
    pr_number: row.pr_number,
    stack: row.stack,
    severity: row.severity,
    impact: row.impact,
    priority: row.priority,
  }));
}

interface ParsedOptions {
  inputs: string[];
  output: string;
  limit: number;
  stacks: string;
  minSeverity: string;
  impact: string;
  priority: string;
  balanced: boolean;
  shuffle: boolean;
  seed: number;
  stratifyRepoType: boolean;
  printSummary: boolean;
}

export interface RunDeps {
  stdout?: (line: string) => void;
}

export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((line: string) => void process.stdout.write(`${line}\n`));

  const program = new Command();
  program
    .name("select-stack-targets")
    .description("Select execution targets from per-stack Gold-set inputs")
    .requiredOption("--inputs <paths...>", "Per-stack target JSON files")
    .requiredOption("--output <path>", "Output execution-target JSON path")
    .option(
      "--limit <n>",
      "Deterministic severity-ranked selection size",
      (v) => Number.parseInt(v, 10),
      0,
    )
    .option("--stacks <stacks>", "Comma-separated stack filter", "")
    .addOption(
      new Option("--min-severity <level>", "Minimum severity")
        .choices(["low", "medium", "high", "critical"])
        .default("low"),
    )
    .option("--impact <csv>", "Comma-separated impact filter", "")
    .option("--priority <csv>", "Comma-separated priority filter", "")
    .option("--balanced", "Round-robin balance selection across stacks", false)
    .option("--shuffle", "Shuffle before selection", false)
    .option("--seed <n>", "Random seed", (v) => Number.parseInt(v, 10), 42)
    .option("--stratify-repo-type", "Stratify sampling evenly by repo_type", false)
    .option("--print-summary", "Print the selection summary JSON to stdout", false)
    .allowExcessArguments(false)
    .exitOverride();

  try {
    program.parse(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : 2;
    }
    throw error;
  }

  const options = program.opts<ParsedOptions>();

  if (options.stratifyRepoType && !options.shuffle) {
    logger.error("--stratify-repo-type requires --shuffle");
    return 2;
  }
  if (options.stratifyRepoType && options.limit <= 0) {
    logger.error("--stratify-repo-type requires --limit > 0");
    return 2;
  }

  const impacts = parseCsvArg(options.impact);
  const priorities = parseCsvArg(options.priority);
  const invalidImpacts = [...impacts].filter((v) => !IMPACTS.has(v));
  const invalidPriorities = [...priorities].filter((v) => !PRIORITIES.has(v));
  if (invalidImpacts.length > 0) {
    logger.error(`invalid --impact: ${invalidImpacts.sort().join(", ")}`);
    return 2;
  }
  if (invalidPriorities.length > 0) {
    logger.error(`invalid --priority: ${invalidPriorities.sort().join(", ")}`);
    return 2;
  }

  let rows = dedupeRows(await loadTargets(options.inputs));
  rows = filterRows(rows, parseCsvArg(options.stacks), options.minSeverity, impacts, priorities);

  if (options.stratifyRepoType) {
    rows = selectStratified(rows, options.limit, options.seed, options.balanced);
  } else {
    if (options.shuffle) {
      new SeededRandom(options.seed).shuffle(rows);
    } else {
      rows = [...rows].sort(compareRankDescending);
    }
    if (options.limit > 0) {
      rows = options.balanced
        ? selectBalanced(rows, options.limit, !options.shuffle)
        : rows.slice(0, options.limit);
    }
  }

  const outputDir = dirname(options.output);
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
  }
  await writeFile(options.output, `${JSON.stringify(toOutput(rows), null, 2)}\n`, "utf-8");

  const summary = summarize(rows);
  for (const warning of summary.coverage_warnings) {
    logger.warn(warning);
  }
  if (options.printSummary) {
    // stdout is the machine-readable contract for --print-summary
    // consumers -- keep this on stdout, not the logger.
    stdout(JSON.stringify(summary, null, 2));
  }
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
