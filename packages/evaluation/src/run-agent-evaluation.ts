#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  type LeadEngineerReport,
  LeadEngineerReportSchema,
  toEvaluationFormat,
} from "@code-review-agent/agent-core";
import { Command } from "commander";
import { readJsonl, writeJsonlAtomic } from "./lib/jsonl.js";
import { getLogger } from "./lib/logging.js";

const logger = getLogger("run-agent-evaluation");

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 1_800_000;

const sleepImpl = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface SeededOrGoldItem {
  id: string;
  repository: string;
  pr_number: number;
}

export interface SendTaskOptions {
  fetch?: typeof fetch;
}

/** POST a data-part task to an A2A endpoint (`{endpoint}/tasks/send`) and return the task id. */
export async function sendTask(
  endpoint: string,
  githubToken: string,
  data: Record<string, unknown>,
  options: SendTaskOptions = {},
): Promise<string> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(`${endpoint}/tasks/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: { role: "user", parts: [{ kind: "data", data }] },
    }),
  });
  if (!response.ok) {
    throw new Error(`A2A send failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { task: { id: string } };
  return body.task.id;
}

export interface PollTaskOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

/** Poll `{endpoint}/tasks/{taskId}` until completed and return the parsed LeadEngineerReport. */
export async function pollTask(
  endpoint: string,
  githubToken: string,
  taskId: string,
  options: PollTaskOptions = {},
): Promise<LeadEngineerReport> {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? sleepImpl;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;

  for (;;) {
    const response = await fetchImpl(`${endpoint}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${githubToken}` },
    });
    if (!response.ok) {
      throw new Error(`A2A poll failed: ${response.status} ${await response.text()}`);
    }
    const task = (await response.json()) as {
      status: string;
      message: { parts: Array<{ kind: string; data?: unknown }> } | null;
      error: string | null;
    };
    if (task.status === "completed") {
      const dataPart = task.message?.parts.find((part) => part.kind === "data");
      if (!dataPart) {
        throw new Error(`Task ${taskId} completed but has no data part`);
      }
      return LeadEngineerReportSchema.parse(dataPart.data);
    }
    if (task.status === "failed") {
      throw new Error(`Task ${taskId} failed: ${task.error ?? "?"}`);
    }
    if (now() > deadline) {
      throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms (status=${task.status})`);
    }
    await sleep(pollIntervalMs);
  }
}

export interface EvaluateItemOptions extends PollTaskOptions {
  baseUrl: string;
  githubToken: string;
  modelId?: string;
}

export interface PredictionRow {
  id: string;
  agent_findings: Array<{
    path: string;
    line: number;
    category: string;
    severity: string;
    impact: string;
    priority: string;
    summary: string;
  }>;
  lead_decisions: Array<{ path: string; line: number; decision: string }>;
}

/**
 * Gold/Seeded evaluation taxonomy (correctness/performance/...) doesn't match
 * the agent's perspective-based categories (technical/security), so
 * category-aware matching in score-evaluation.ts would reject every
 * non-security pair. Collapsing to "unknown" makes matching fall back to
 * path+line+severity, mirroring evaluation/tools/run_agent_evaluation.py's
 * _to_predictions (this normalization is evaluation-harness-specific and
 * intentionally not part of agent-core's production toEvaluationFormat).
 */
function normalizeCategoriesForEvaluation(pred: PredictionRow): PredictionRow {
  return {
    ...pred,
    agent_findings: pred.agent_findings.map((finding) => ({
      ...finding,
      category: finding.category === "security" ? "security" : "unknown",
    })),
  };
}

/** Evaluate one Gold/Seeded item via the orchestrator's single-call PR review. */
export async function evaluateItem(
  item: SeededOrGoldItem,
  options: EvaluateItemOptions,
): Promise<PredictionRow> {
  const [owner, repo] = item.repository.split("/");
  const endpoint = `${options.baseUrl}/orchestrator`;
  const data: Record<string, unknown> = { owner, repo, prNumber: item.pr_number };
  if (options.modelId) {
    data.modelId = options.modelId;
  }
  const taskId = await sendTask(endpoint, options.githubToken, data, options);
  const report = await pollTask(endpoint, options.githubToken, taskId, options);
  return normalizeCategoriesForEvaluation(
    toEvaluationFormat(report, item.id) as unknown as PredictionRow,
  );
}

export interface ConcurrentResult {
  predictions: PredictionRow[];
  failedIds: string[];
}

/** Evaluate `items` with at most `concurrency` running at once, preserving input order in the output. */
export async function evaluateConcurrently<T extends { id: string }>(
  items: T[],
  evaluateFn: (item: T) => Promise<PredictionRow>,
  concurrency: number,
): Promise<ConcurrentResult> {
  const results: Array<PredictionRow | undefined> = new Array(items.length);
  const failed: boolean[] = new Array(items.length).fill(false);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      logger.info(`[${item.id.slice(0, 60)}] ... started`);
      try {
        results[index] = await evaluateFn(item);
        logger.info(`[${item.id.slice(0, 60)}] ... done`);
      } catch (error) {
        failed[index] = true;
        logger.warn(`[${item.id.slice(0, 60)}] ... failed: ${String(error)}`);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const predictions = results.filter((row): row is PredictionRow => row !== undefined);
  const failedIds = items.filter((_, index) => failed[index]).map((item) => item.id);
  return { predictions, failedIds };
}

function failedIdsSidecarPath(outputPath: string): string {
  return `${outputPath.replace(/\.jsonl$/, "")}.failed_ids.json`;
}

/** Write predictions.jsonl and its `{output}.failed_ids.json` sidecar (naming per docs/eval-sharded-execution-spec.md §2.4). */
export async function writePredictionsAndSidecar(
  outputPath: string,
  predictions: PredictionRow[],
  failedIds: string[],
): Promise<void> {
  await writeJsonlAtomic(outputPath, predictions);
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(outputPath) || ".", { recursive: true });
  await writeFile(failedIdsSidecarPath(outputPath), JSON.stringify(failedIds), "utf-8");
}

interface CliOptions {
  seeded: string;
  gold?: string;
  pred: string;
  baseUrl: string;
  concurrency: string;
  pollInterval: string;
  timeout: string;
  modelId?: string;
}

function createCli(): Command {
  return new Command()
    .name("run-agent-evaluation")
    .description(
      "Evaluate Gold/Seeded PR items via the TypeScript A2A server's /orchestrator endpoint",
    )
    .requiredOption("--seeded <path>", "Seeded set JSONL path")
    .option("--gold <path>", "Gold set JSONL path (optional)")
    .requiredOption("--pred <path>", "Predictions JSONL output path")
    .option("--base-url <url>", "A2A server base URL", DEFAULT_BASE_URL)
    .option("--concurrency <number>", "Max items evaluated at once", String(DEFAULT_CONCURRENCY))
    .option("--poll-interval <seconds>", "Poll interval in seconds", "3")
    .option("--timeout <seconds>", "Per-item timeout in seconds", "1800")
    .option("--model-id <id>", "Model id forwarded to the orchestrator");
}

export interface MainDependencies {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function main(
  argv: string[] = process.argv,
  dependencies: MainDependencies = {},
): Promise<number> {
  const env = dependencies.env ?? process.env;
  const githubToken = env.GITHUB_TOKEN;
  if (!githubToken) {
    logger.error("GITHUB_TOKEN is required (set in .env)");
    return 2;
  }

  const options = createCli().parse(argv).opts<CliOptions>();
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const pollIntervalMs = Number(options.pollInterval) * 1000;
  const timeoutMs = Number(options.timeout) * 1000;

  const items: SeededOrGoldItem[] = [];
  if (options.gold) {
    items.push(...((await readJsonl(options.gold)) as SeededOrGoldItem[]));
  }
  items.push(...((await readJsonl(options.seeded)) as SeededOrGoldItem[]));
  logger.info(`Items to evaluate: ${items.length}`);

  const { predictions, failedIds } = await evaluateConcurrently(
    items,
    (item) =>
      evaluateItem(item, {
        baseUrl,
        githubToken,
        modelId: options.modelId,
        fetch: dependencies.fetch,
        sleep: dependencies.sleep,
        pollIntervalMs,
        timeoutMs,
      }),
    Number(options.concurrency),
  );

  await writePredictionsAndSidecar(options.pred, predictions, failedIds);
  logger.info(`Wrote ${predictions.length} predictions, ${failedIds.length} failed`);
  return failedIds.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
