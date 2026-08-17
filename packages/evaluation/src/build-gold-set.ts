#!/usr/bin/env node
/**
 * Build Gold PR dataset from GitHub pull requests.
 *
 * Usage:
 *   build-gold-set --input evaluation/data/pr_targets.json \
 *     --output evaluation/data/gold_pr_set.jsonl
 *
 * Input format (JSON):
 * [
 *   {"repository": "owner/repo", "pr_number": 123},
 *   {"repository": "owner/repo", "pr_number": 456}
 * ]
 *
 * Required env: GITHUB_TOKEN
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { apiGet as defaultApiGet, fetchPrFiles as defaultFetchPrFiles } from "./lib/github-rest.js";
import { writeJsonlAtomic as defaultWriteJsonlAtomic } from "./lib/jsonl.js";
import { getLogger } from "./lib/logging.js";
import { isProductionCodeFile } from "./lib/target-criteria.js";

const logger = getLogger("build_gold_set");

const SEVERITIES: ReadonlySet<string> = new Set(["critical", "high", "medium", "low", "unknown"]);
const IMPACTS: ReadonlySet<string> = new Set([
  "security",
  "correctness",
  "performance",
  "maintainability",
  "unknown",
]);
const PRIORITIES: ReadonlySet<string> = new Set(["high", "medium", "low", "unknown"]);
const STACKS: ReadonlySet<string> = new Set(["react", "vue", "angular", "svelte"]);

export interface Target {
  repository: string;
  pr_number: number;
  stack: string;
  severity: string;
  impact: string;
  priority: string;
}

export interface FileChange {
  path: string;
  patch: string;
}

export interface HumanFinding {
  category: string;
  severity: string;
  impact: string;
  priority: string;
  path: string;
  line: number;
  summary: string;
  source: string | undefined;
}

export interface GoldItem {
  id: string;
  repository: string;
  pr_number: number;
  stack: string;
  title: string;
  body: string;
  labels: string[];
  file_changes: FileChange[];
  human_findings: HumanFinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAxis(value: unknown, choices: ReadonlySet<string>): string {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim().toLowerCase();
  return choices.has(normalized) ? normalized : "unknown";
}

/** Load and validate PR targets, defaulting missing/invalid axes to "unknown". */
export function loadTargets(path: string): Target[] {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error(`input is not a JSON array: ${path}`);
  }
  return raw.map((item: unknown, index: number) => {
    if (!isRecord(item)) {
      throw new Error(`invalid target at [${index}]`);
    }
    const repository = String(item.repository);
    const prNumber = Number(item.pr_number);
    const stack = item.stack;
    if (typeof stack !== "string" || !STACKS.has(stack)) {
      const allowed = [...STACKS].sort().join(", ");
      throw new Error(
        `invalid target at [${index}]: stack=${JSON.stringify(stack)}; expected one of: ${allowed}`,
      );
    }
    return {
      repository,
      pr_number: prNumber,
      stack,
      severity: normalizeAxis(item.severity, SEVERITIES),
      impact: normalizeAxis(item.impact, IMPACTS),
      priority: normalizeAxis(item.priority, PRIORITIES),
    };
  });
}

const CATEGORY_KEYWORDS: [string, string[]][] = [
  [
    "security",
    [
      "xss",
      "csrf",
      "security",
      "token",
      "auth",
      "ssrf",
      "idor",
      "access control",
      "mass assignment",
      "sql injection",
      "unsafe deserialization",
      "cve",
    ],
  ],
  ["performance", ["slow", "performance", "render", "latency", "n+1", "index", "query plan"]],
  [
    "correctness",
    [
      "bug",
      "incorrect",
      "wrong",
      "null",
      "undefined",
      "transaction",
      "race condition",
      "consistency",
      "idempotency",
    ],
  ],
  ["maintainability", ["readability", "refactor", "maintain", "complex"]],
  ["style", ["style", "format", "naming", "lint"]],
];

/** Classify a finding summary into a category by keyword, in priority order. */
export function normalizeCategory(text: string): string {
  const lowered = text.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => lowered.includes(keyword))) {
      return category;
    }
  }
  return "unknown";
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function extractLine(comment: Record<string, unknown>): number {
  if (isPositiveInt(comment.line)) {
    return comment.line;
  }
  if (isPositiveInt(comment.original_line)) {
    return comment.original_line;
  }
  return 1;
}

export type ApiGet = (url: string, token: string) => Promise<unknown>;
export type FetchPrFiles = (
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
) => Promise<FileChange[]>;

const REVIEW_COMMENTS_PER_PAGE = 100;
const REVIEW_COMMENTS_MAX_PAGES = 100;

async function fetchReviewComments(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
  apiGet: ApiGet,
): Promise<Record<string, unknown>[]> {
  const comments: Record<string, unknown>[] = [];
  for (let page = 1; page <= REVIEW_COMMENTS_MAX_PAGES; page += 1) {
    const url =
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments` +
      `?per_page=${REVIEW_COMMENTS_PER_PAGE}&page=${page}`;
    const pageData = await apiGet(url, token);
    if (!Array.isArray(pageData)) {
      throw new TypeError("GitHub PR review comments response must be an array");
    }
    comments.push(...(pageData as Record<string, unknown>[]));
    if (pageData.length < REVIEW_COMMENTS_PER_PAGE) {
      return comments;
    }
  }
  throw new Error(
    `GitHub PR review comments pagination exceeded ${REVIEW_COMMENTS_MAX_PAGES} pages`,
  );
}

export interface BuildGoldItemDeps {
  apiGet?: ApiGet;
  fetchPrFiles?: FetchPrFiles;
}

/** Split "owner/repo" into its two path segments (repo may itself contain no further slash). */
function splitRepository(repository: string): [string, string] {
  const idx = repository.indexOf("/");
  if (idx === -1) {
    throw new Error(`invalid repository: ${repository}`);
  }
  return [repository.slice(0, idx), repository.slice(idx + 1)];
}

export async function buildGoldItem(
  target: Target,
  token: string,
  deps: BuildGoldItemDeps = {},
): Promise<GoldItem> {
  const apiGet = deps.apiGet ?? defaultApiGet;
  const fetchPrFiles = deps.fetchPrFiles ?? defaultFetchPrFiles;
  const [owner, repo] = splitRepository(target.repository);

  const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${target.pr_number}`;
  const prData = (await apiGet(prUrl, token)) as Record<string, unknown>;
  const files = await fetchPrFiles(owner, repo, target.pr_number, token);
  const comments = await fetchReviewComments(owner, repo, target.pr_number, token, apiGet);

  const fileChanges: FileChange[] = files
    .filter((file) => isProductionCodeFile(file.path))
    .map((file) => ({ path: file.path, patch: file.patch }));

  const humanFindings: HumanFinding[] = [];
  for (const comment of comments) {
    const body = typeof comment.body === "string" ? comment.body.trim() : "";
    const path = typeof comment.path === "string" ? comment.path : "";
    if (!body || !path || !isProductionCodeFile(path)) {
      continue;
    }
    const summary = body.replace(/\s+/g, " ");
    humanFindings.push({
      category: normalizeCategory(summary),
      severity: target.severity,
      impact: target.impact,
      priority: target.priority,
      path,
      line: extractLine(comment),
      summary,
      source: (comment.html_url as string | undefined) ?? (prData.html_url as string | undefined),
    });
  }

  const labels = Array.isArray(prData.labels)
    ? (prData.labels as unknown[])
        .filter((label): label is Record<string, unknown> => isRecord(label) && "name" in label)
        .map((label) => String(label.name))
    : [];

  return {
    id: `${target.repository}#${target.pr_number}`,
    repository: target.repository,
    pr_number: target.pr_number,
    stack: target.stack,
    title: typeof prData.title === "string" ? prData.title : "",
    body: typeof prData.body === "string" ? prData.body : "",
    labels,
    file_changes: fileChanges,
    human_findings: humanFindings,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

export interface RunDeps {
  apiGet?: ApiGet;
  fetchPrFiles?: FetchPrFiles;
  writeJsonlAtomic?: typeof defaultWriteJsonlAtomic;
  sleep?: (seconds: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

interface ParsedOptions {
  input: string;
  output: string;
  sleep: number;
}

export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const writeJsonlAtomic = deps.writeJsonlAtomic ?? defaultWriteJsonlAtomic;
  const sleep = deps.sleep ?? defaultSleep;

  const program = new Command();
  program
    .name("build-gold-set")
    .description("Build Gold PR dataset from GitHub")
    .requiredOption("--input <path>", "Path to input target JSON")
    .requiredOption("--output <path>", "Path to output JSONL")
    .option("--sleep <seconds>", "Sleep between API calls", (v) => Number.parseFloat(v), 0.2)
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

  const token = env.GITHUB_TOKEN;
  if (!token) {
    logger.error("GITHUB_TOKEN is required");
    return 2;
  }

  const targets = loadTargets(options.input);

  const items: GoldItem[] = [];
  for (const target of targets) {
    let item: GoldItem;
    try {
      item = await buildGoldItem(target, token, deps);
    } catch (error) {
      logger.warn(`skip ${target.repository}#${target.pr_number}: ${errorMessage(error)}`);
      continue;
    }

    if (item.file_changes.length === 0) {
      logger.info(`no target file changes: ${target.repository}#${target.pr_number}`);
      continue;
    }
    if (item.human_findings.length === 0) {
      logger.info(`no review comments: ${target.repository}#${target.pr_number}`);
      continue;
    }

    items.push(item);
    await sleep(options.sleep);
  }

  await writeJsonlAtomic(options.output, items);
  logger.info(`Done. Gold items: ${items.length}`);
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
