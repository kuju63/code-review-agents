#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Agent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { Command, InvalidArgumentError } from "commander";
import { z } from "zod";
import { hasInlineReviewComments, hasProductionCodeChange } from "./lib/target-criteria.js";

export const DEFAULT_STACKS = ["react", "vue", "angular", "svelte"] as const;
export const MIN_STARS = 5000;
export const RELEASE_WINDOW_DAYS = 180;
export const PR_SEARCH_WINDOW_DAYS = 180;
export const MAX_CHANGED_FILES = 20;
export const MAX_CHANGED_LINES = 1000;
export const LLM_TIMEOUT_MILLISECONDS = 120_000;

export interface RepoCandidate {
  repository: string;
  repo_type: string;
  stack: string;
}

export const ReviewAssessmentSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  impact: z.enum(["security", "correctness", "performance", "maintainability"]),
  priority: z.enum(["high", "medium", "low"]),
  rationale: z.string(),
});

export type ReviewAssessment = z.infer<typeof ReviewAssessmentSchema>;
export type ReviewAssessor = (
  prTitle: string,
  reviewTexts: string[],
) => Promise<ReviewAssessment | undefined>;
export type JsonObject = Record<string, unknown>;
export type Target = Record<string, unknown> & {
  repository: string;
  pr_number: number;
  stack: string;
};

const ASSESSOR_SYSTEM_PROMPT = `You analyze the review findings on a pull request and classify them along THREE INDEPENDENT axes. Do not let one axis determine another; judge each on its own terms.

1. severity (how serious the underlying defect is):
   critical | high | medium | low
2. impact (which software quality attribute the finding primarily affects):
   security | correctness | performance | maintainability
3. priority (how urgently the team should act on it, considering severity, blast radius, and reachability together):
   high | medium | low

A low-severity finding can still be high-priority (e.g. trivial fix, user-facing), and a high-severity finding can be low-priority (e.g. unreachable code path). Provide a brief, non-empty rationale.
`;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const asObject = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

const asObjectArray = (value: unknown): JsonObject[] | undefined =>
  Array.isArray(value) && value.every((item) => asObject(item) !== undefined)
    ? (value as JsonObject[])
    : undefined;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);

const repositoryPath = (repository: string): string => {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error(`Invalid repository: ${repository}`);
  }
  return parts.map(encodeURIComponent).join("/");
};

export function collectReviewTexts(inline: JsonObject[], reviews: JsonObject[]): string[] {
  return [...inline, ...reviews]
    .map((item) => asString(item.body).trim())
    .filter((body) => body.length > 0);
}

export function hasReviewComments(inline: JsonObject[], _reviews: JsonObject[]): boolean {
  return hasInlineReviewComments(inline);
}

export function withinChangeLimits(
  prDetail: JsonObject,
  maxFiles = MAX_CHANGED_FILES,
  maxLines = MAX_CHANGED_LINES,
): boolean {
  return (
    asNumber(prDetail.changed_files) <= maxFiles &&
    asNumber(prDetail.additions) + asNumber(prDetail.deletions) <= maxLines
  );
}

export function parseIso(value: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

export interface GitHubClientOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  maxPages?: number;
  maxRateLimitWaitMilliseconds?: number;
}

export class GitHubClient {
  static readonly BASE = "https://api.github.com";
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #now: () => number;
  readonly #maxPages: number;
  readonly #maxRateLimitWaitMilliseconds: number;

  constructor(token: string, options: GitHubClientOptions = {}) {
    this.#token = token;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? sleep;
    this.#now = options.now ?? Date.now;
    this.#maxPages = options.maxPages ?? 100;
    this.#maxRateLimitWaitMilliseconds = options.maxRateLimitWaitMilliseconds ?? 62_000;
  }

  async #request(url: URL): Promise<Response> {
    let current = url;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (current.protocol !== "https:" || current.hostname !== "api.github.com") {
        throw new Error(`Refusing GitHub request to ${current.origin}`);
      }
      const response = await this.#fetch(current, {
        headers: {
          Authorization: `Bearer ${this.#token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }
      const location = response.headers.get("location");
      if (!location || redirects === 5) {
        throw new Error("Invalid GitHub API redirect");
      }
      current = new URL(location, current);
    }
    throw new Error("Too many GitHub API redirects");
  }

  async get(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const url = new URL(path, GitHubClient.BASE);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.#request(url);
      if (response.status === 401 || response.status === 404) {
        return undefined;
      }
      if (response.status === 403 || response.status === 429) {
        const body = await response.text();
        if (response.status === 429 || body.toLowerCase().includes("rate limit")) {
          if (attempt === 2) {
            throw new Error(`GitHub API rate limit retries exhausted: ${url.href}`);
          }
          const fallbackReset = Math.floor(this.#now() / 1000) + 60;
          const parsedReset = Number.parseInt(response.headers.get("x-ratelimit-reset") ?? "", 10);
          const reset = Number.isFinite(parsedReset) ? parsedReset : fallbackReset;
          const waitSeconds = Math.max(reset - Math.floor(this.#now() / 1000), 1) + 2;
          const waitMilliseconds = Math.min(waitSeconds * 1000, this.#maxRateLimitWaitMilliseconds);
          console.error(`[rate limit] waiting ${Math.ceil(waitMilliseconds / 1000)}s ...`);
          await this.#sleep(waitMilliseconds);
          continue;
        }
        throw new Error(`GitHub API request failed: ${response.status} ${body}`);
      }
      if (!response.ok) {
        throw new Error(`GitHub API request failed: ${response.status} ${await response.text()}`);
      }
      return response.json();
    }
    throw new Error(`GitHub API rate limit retries exhausted: ${url.href}`);
  }

  async getRepo(repository: string): Promise<JsonObject | undefined> {
    return asObject(await this.get(`/repos/${repositoryPath(repository)}`));
  }

  async listReleases(repository: string, perPage = 10): Promise<JsonObject[]> {
    return (
      asObjectArray(
        await this.get(`/repos/${repositoryPath(repository)}/releases`, { per_page: perPage }),
      ) ?? []
    );
  }

  async listTagsWithDates(repository: string, perPage = 10): Promise<string[]> {
    const tags =
      asObjectArray(
        await this.get(`/repos/${repositoryPath(repository)}/tags`, { per_page: perPage }),
      ) ?? [];
    const dates: string[] = [];
    for (const tag of tags.slice(0, perPage)) {
      const sha = asString(asObject(tag.commit)?.sha);
      if (!sha) {
        continue;
      }
      const commit = asObject(
        await this.get(`/repos/${repositoryPath(repository)}/commits/${encodeURIComponent(sha)}`),
      );
      const date = asString(asObject(asObject(commit?.commit)?.committer)?.date);
      if (date) {
        dates.push(date);
      }
      await this.#sleep(100);
    }
    return dates;
  }

  async getPr(repository: string, prNumber: number): Promise<JsonObject | undefined> {
    return asObject(await this.get(`/repos/${repositoryPath(repository)}/pulls/${prNumber}`));
  }

  async listMergedPrs(repository: string, since: string, perPage = 50): Promise<JsonObject[]> {
    const sinceDate = parseIso(since);
    if (!sinceDate) {
      throw new Error(`Invalid ISO 8601 since value: ${since}`);
    }
    const sinceTimestamp = sinceDate.getTime();
    const pullRequests: JsonObject[] = [];
    for (let page = 1; page <= this.#maxPages; page += 1) {
      const batch = asObjectArray(
        await this.get(`/repos/${repositoryPath(repository)}/pulls`, {
          state: "closed",
          sort: "updated",
          direction: "desc",
          per_page: perPage,
          page,
        }),
      );
      if (!batch || batch.length === 0) {
        break;
      }
      for (const pullRequest of batch) {
        const updatedAt = asString(pullRequest.updated_at);
        const updatedDate = parseIso(updatedAt);
        if (!updatedDate) {
          throw new Error(`Invalid GitHub updated_at value: ${updatedAt}`);
        }
        if (updatedDate.getTime() < sinceTimestamp) {
          return pullRequests;
        }
        if (!pullRequest.merged_at) {
          continue;
        }
        pullRequests.push(pullRequest);
      }
      if (batch.length < perPage) {
        break;
      }
      await this.#sleep(300);
    }
    return pullRequests;
  }

  async #fetchPullRequestRows(
    repository: string,
    prNumber: number,
    endpoint: "files" | "comments",
  ): Promise<JsonObject[] | undefined> {
    return asObjectArray(
      await this.get(`/repos/${repositoryPath(repository)}/pulls/${prNumber}/${endpoint}`, {
        per_page: 100,
      }),
    );
  }

  async listPrFiles(repository: string, prNumber: number): Promise<JsonObject[]> {
    return (await this.#fetchPullRequestRows(repository, prNumber, "files")) ?? [];
  }

  async requirePrFiles(repository: string, prNumber: number): Promise<JsonObject[]> {
    const files = await this.#fetchPullRequestRows(repository, prNumber, "files");
    if (!files) {
      throw new Error(`GitHub fetch failed for ${repository}#${prNumber} files`);
    }
    return files;
  }

  async listReviewComments(repository: string, prNumber: number): Promise<JsonObject[]> {
    return (await this.#fetchPullRequestRows(repository, prNumber, "comments")) ?? [];
  }

  async requireReviewComments(repository: string, prNumber: number): Promise<JsonObject[]> {
    const comments = await this.#fetchPullRequestRows(repository, prNumber, "comments");
    if (!comments) {
      throw new Error(`GitHub fetch failed for ${repository}#${prNumber} review comments`);
    }
    return comments;
  }

  async listPrReviews(repository: string, prNumber: number): Promise<JsonObject[]> {
    return (
      asObjectArray(
        await this.get(`/repos/${repositoryPath(repository)}/pulls/${prNumber}/reviews`, {
          per_page: 100,
        }),
      ) ?? []
    );
  }
}

export async function hasRecentRelease(
  client: GitHubClient,
  repository: string,
  now: Date,
  days = RELEASE_WINDOW_DAYS,
): Promise<boolean> {
  const cutoff = now.getTime() - days * 86_400_000;
  for (const release of await client.listReleases(repository)) {
    const published = parseIso(asString(release.published_at));
    if (published && published.getTime() >= cutoff) {
      return true;
    }
  }
  for (const tagDate of await client.listTagsWithDates(repository)) {
    const parsed = parseIso(tagDate);
    if (parsed && parsed.getTime() >= cutoff) {
      return true;
    }
  }
  return false;
}

export function makeLlmAssessor(modelId: string, llmBaseUrl?: string): ReviewAssessor {
  const model = new OpenAIModel({
    api: "chat",
    modelId,
    clientConfig: {
      ...(llmBaseUrl ? { baseURL: llmBaseUrl } : {}),
      timeout: LLM_TIMEOUT_MILLISECONDS,
    },
    ...(llmBaseUrl ? { temperature: 0 } : {}),
  });
  const agent = new Agent({ model, systemPrompt: ASSESSOR_SYSTEM_PROMPT, tools: [] });
  return async (prTitle, reviewTexts) => {
    const joined = reviewTexts.map((text) => `- ${text}`).join("\n\n");
    const prompt = `PR title: ${prTitle}\n\nReview findings:\n${joined}`;
    try {
      const result = await agent.invoke(prompt, {
        structuredOutputSchema: ReviewAssessmentSchema,
      });
      if (result.structuredOutput === undefined) {
        return undefined;
      }
      const assessment = ReviewAssessmentSchema.parse(result.structuredOutput);
      console.error(
        `LLM assessment for PR ${JSON.stringify(prTitle)}: severity=${assessment.severity} impact=${assessment.impact} priority=${assessment.priority} rationale=${assessment.rationale}`,
      );
      return assessment;
    } catch (error) {
      console.error("LLM assessment call failed; skipping PR", error);
      return undefined;
    }
  };
}

export async function validateRepo(
  client: GitHubClient,
  candidate: RepoCandidate,
  now: Date,
  minStars = MIN_STARS,
  releaseWindowDays = RELEASE_WINDOW_DAYS,
): Promise<[boolean, string]> {
  const repository = await client.getRepo(candidate.repository);
  if (!repository) {
    return [false, "repository not found"];
  }
  if (repository.archived) {
    return [false, "repository archived"];
  }
  const stars = asNumber(repository.stargazers_count);
  if (stars < minStars) {
    return [false, `stars=${stars} < ${minStars}`];
  }
  if (!(await hasRecentRelease(client, candidate.repository, now, releaseWindowDays))) {
    return [false, `no release in last ${releaseWindowDays} days`];
  }
  return [true, `stars=${stars}, recent_release=yes`];
}

export async function buildTarget(
  client: GitHubClient,
  candidate: RepoCandidate,
  pullRequest: JsonObject,
  assessor: ReviewAssessor,
  maxChangedFiles = MAX_CHANGED_FILES,
  maxChangedLines = MAX_CHANGED_LINES,
): Promise<Target | undefined> {
  const prNumber = asNumber(pullRequest.number);
  const detail = await client.getPr(candidate.repository, prNumber);
  if (!detail || !withinChangeLimits(detail, maxChangedFiles, maxChangedLines)) {
    return undefined;
  }
  const files = await client.listPrFiles(candidate.repository, prNumber);
  if (!hasProductionCodeChange(files)) {
    return undefined;
  }
  const inline = await client.listReviewComments(candidate.repository, prNumber);
  const reviews = await client.listPrReviews(candidate.repository, prNumber);
  if (!hasReviewComments(inline, reviews)) {
    return undefined;
  }
  const assessment = await assessor(
    asString(pullRequest.title),
    collectReviewTexts(inline, reviews),
  );
  if (!assessment) {
    return undefined;
  }
  return {
    repository: candidate.repository,
    pr_number: prNumber,
    stack: candidate.stack,
    repo_type: candidate.repo_type,
    severity: assessment.severity,
    impact: assessment.impact,
    priority: assessment.priority,
  };
}

export async function revalidateExistingTargets(
  client: GitHubClient,
  targets: Target[],
): Promise<Target[]> {
  const accepted: Target[] = [];
  for (const target of targets) {
    const files = await client.requirePrFiles(target.repository, target.pr_number);
    if (!hasProductionCodeChange(files)) {
      continue;
    }
    const inline = await client.requireReviewComments(target.repository, target.pr_number);
    if (!hasInlineReviewComments(inline)) {
      continue;
    }
    accepted.push(target);
  }
  return accepted;
}

const TargetRowSchema = z
  .object({
    repository: z.string(),
    pr_number: z.number().int().nonnegative(),
    stack: z.string(),
  })
  .loose();

export const parseTargetRows = (value: unknown, path: string): Target[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Existing target file is not a JSON array: ${path}`);
  }
  return value.map((row, index) => {
    const parsed = TargetRowSchema.safeParse(row);
    if (!parsed.success) {
      throw new Error(`${path}: invalid target row ${index}`);
    }
    return parsed.data as Target;
  });
};

export async function loadSkippedTargets(
  outputDir: string,
  candidates: RepoCandidate[],
  skipRepos: Set<string>,
): Promise<Target[]> {
  const skippedByStack = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (skipRepos.has(candidate.repository)) {
      const repositories = skippedByStack.get(candidate.stack) ?? new Set<string>();
      repositories.add(candidate.repository);
      skippedByStack.set(candidate.stack, repositories);
    }
  }
  const existing: Target[] = [];
  const seen = new Set<string>();
  for (const [stack, repositories] of skippedByStack) {
    const path = join(outputDir, `pr_targets_${stack}.json`);
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const parsedRows = JSON.parse(contents);
    if (!Array.isArray(parsedRows)) {
      throw new Error(`Existing target file is not a JSON array: ${path}`);
    }
    for (const [index, value] of parsedRows.entries()) {
      const parsed = TargetRowSchema.safeParse(value);
      if (!parsed.success) {
        console.error(`Ignoring invalid existing target in ${path} at row ${index}`);
        continue;
      }
      const row = parsed.data;
      const repository = row.repository;
      if (!repositories.has(repository)) {
        continue;
      }
      const prNumber = row.pr_number;
      const key = `${repository}\0${prNumber}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      existing.push(row as Target);
    }
  }
  return existing;
}

export async function writeStackOutputs(
  targets: Target[],
  outputDir: string,
  stacks: readonly string[] = DEFAULT_STACKS,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const grouped = new Map<string, Target[]>(stacks.map((stack) => [stack, []]));
  for (const target of targets) {
    const rows = grouped.get(target.stack) ?? [];
    rows.push(target);
    grouped.set(target.stack, rows);
  }
  for (const [stack, rows] of grouped) {
    const outputPath = join(outputDir, `pr_targets_${stack}.json`);
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(rows, null, 2)}\n`);
      await rename(temporaryPath, outputPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

export async function discoverStackOutputs(outputDir: string): Promise<string[]> {
  const stacks = (await readdir(outputDir))
    .map((name) => /^pr_targets_(.+)\.json$/.exec(name)?.[1])
    .filter((stack): stack is string => stack !== undefined);
  return [...new Set(stacks)].sort();
}

export async function loadStackOutputs(
  outputDir: string,
  stacks: readonly string[] = DEFAULT_STACKS,
): Promise<Target[]> {
  const targets: Target[] = [];
  for (const stack of stacks) {
    const path = join(outputDir, `pr_targets_${stack}.json`);
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Required target file not found: ${path}`);
      }
      throw error;
    }
    targets.push(...parseTargetRows(JSON.parse(contents), path));
  }
  return targets;
}

interface CliOptions {
  repos: string;
  outputDir: string;
  since?: string;
  maxPrsPerRepo: number;
  maxTargetsPerRepo: number;
  minStars: number;
  releaseWindowDays: number;
  maxChangedFiles: number;
  maxChangedLines: number;
  modelId?: string;
  llmBaseUrl?: string;
  skipRepos: string;
  revalidateExisting: boolean;
}

export const parseInteger = (value: string): number => {
  const normalized = value.trim();
  const parsed = Number(normalized);
  if (normalized.length === 0 || !Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer");
  }
  return parsed;
};

export function createCli(): Command {
  return new Command()
    .name("discover-candidate-prs")
    .description("Discover per-stack Gold-set PR targets")
    .option(
      "--repos <path>",
      "Path to repo_candidates.json",
      "evaluation/input/repo_candidates.json",
    )
    .option(
      "--output-dir <path>",
      "Directory to write pr_targets_{stack}.json into",
      "evaluation/input",
    )
    .option(
      "--since <date>",
      "Search PRs merged/updated after this date (ISO 8601). Default: 6 months ago.",
    )
    .option(
      "--max-prs-per-repo <number>",
      "Max PRs to fetch per repo before evaluating",
      parseInteger,
      60,
    )
    .option(
      "--max-targets-per-repo <number>",
      "Max accepted targets to keep per repo",
      parseInteger,
      10,
    )
    .option("--min-stars <number>", "Minimum repository star count", parseInteger, MIN_STARS)
    .option(
      "--release-window-days <number>",
      "Recent-release window in days",
      parseInteger,
      RELEASE_WINDOW_DAYS,
    )
    .option(
      "--max-changed-files <number>",
      "Maximum changed files per PR",
      parseInteger,
      MAX_CHANGED_FILES,
    )
    .option(
      "--max-changed-lines <number>",
      "Maximum changed lines (additions + deletions) per PR",
      parseInteger,
      MAX_CHANGED_LINES,
    )
    .option("--model-id <id>", "LLM model id for assessment")
    .option("--llm-base-url <url>", "OpenAI-compatible base URL")
    .option("--skip-repos <repositories>", "Comma-separated repos to skip", "")
    .option(
      "--revalidate-existing",
      "Reapply shared production-change and inline-comment criteria to existing per-stack targets without LLM reclassification",
      false,
    );
}

export interface MainDependencies {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  loadEnvironment?: () => void;
  clientFactory?: (token: string) => GitHubClient;
  assessorFactory?: (modelId: string, llmBaseUrl?: string) => ReviewAssessor;
}

export async function main(
  argv: string[] = process.argv,
  dependencies: MainDependencies = {},
): Promise<number> {
  (
    dependencies.loadEnvironment ??
    (() => {
      try {
        process.loadEnvFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    })
  )();
  const options = createCli().parse(argv).opts<CliOptions>();
  const env = dependencies.env ?? process.env;
  const token = env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN not set");
    return 1;
  }
  const client = (dependencies.clientFactory ?? ((value) => new GitHubClient(value)))(token);
  if (options.revalidateExisting) {
    const stacks = await discoverStackOutputs(options.outputDir);
    const targets = await loadStackOutputs(options.outputDir, stacks);
    const accepted = await revalidateExistingTargets(client, targets);
    await writeStackOutputs(accepted, options.outputDir, stacks);
    console.error(
      `Revalidated targets: before=${targets.length}, after=${accepted.length}, removed=${targets.length - accepted.length}`,
    );
    return 0;
  }
  const modelId = options.modelId ?? env.SEEDED_GEN_MODEL_ID;
  if (!modelId) {
    console.error("--model-id or SEEDED_GEN_MODEL_ID is required");
    return 1;
  }
  const llmBaseUrl = options.llmBaseUrl ?? env.SEEDED_GEN_LLM_BASE_URL;
  const assessor = (dependencies.assessorFactory ?? makeLlmAssessor)(modelId, llmBaseUrl);
  const now = (dependencies.now ?? (() => new Date()))();
  const since =
    options.since ??
    new Date(now.getTime() - PR_SEARCH_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
  const skipRepos = new Set<string>(
    options.skipRepos
      .split(",")
      .map((repository: string) => repository.trim())
      .filter(Boolean),
  );
  const rawCandidates = JSON.parse(await readFile(options.repos, "utf8"));
  if (!Array.isArray(rawCandidates)) {
    throw new Error(`Repository candidate file is not a JSON array: ${options.repos}`);
  }
  const candidates = rawCandidates.map((value): RepoCandidate => {
    const candidate = asObject(value);
    if (
      !candidate ||
      typeof candidate.repository !== "string" ||
      typeof candidate.repo_type !== "string" ||
      typeof candidate.stack !== "string"
    ) {
      throw new Error(`Invalid repository candidate in ${options.repos}`);
    }
    return {
      repository: candidate.repository,
      repo_type: candidate.repo_type,
      stack: candidate.stack,
    };
  });
  const allTargets = await loadSkippedTargets(options.outputDir, candidates, skipRepos);
  const pause = dependencies.sleep ?? sleep;
  for (const candidate of candidates) {
    if (skipRepos.has(candidate.repository)) {
      console.error(`[${candidate.repository}] SKIP (requested)`);
      continue;
    }
    console.error(`[${candidate.repository}] validating ...`);
    let validation: [boolean, string];
    try {
      validation = await validateRepo(
        client,
        candidate,
        now,
        options.minStars,
        options.releaseWindowDays,
      );
    } catch (error) {
      console.error(`SKIP: validation error: ${String(error)}`);
      continue;
    }
    const [valid, reason] = validation;
    if (!valid) {
      console.error(`SKIP: ${reason}`);
      continue;
    }
    console.error(`OK: ${reason}`);
    let pullRequests: JsonObject[];
    try {
      pullRequests = await client.listMergedPrs(candidate.repository, since, 50);
    } catch (error) {
      console.error(`SKIP: failed to list PRs: ${String(error)}`);
      continue;
    }
    console.error(`found ${pullRequests.length} merged PRs`);
    const repositoryTargets: Target[] = [];
    for (const pullRequest of pullRequests.slice(0, options.maxPrsPerRepo)) {
      await pause(400);
      try {
        const target = await buildTarget(
          client,
          candidate,
          pullRequest,
          assessor,
          options.maxChangedFiles,
          options.maxChangedLines,
        );
        if (target) {
          repositoryTargets.push(target);
        }
      } catch (error) {
        console.error(`PR #${asNumber(pullRequest.number)} failed:`, error);
        await pause(1000);
        continue;
      }
      if (repositoryTargets.length >= options.maxTargetsPerRepo) {
        break;
      }
    }
    console.error(`accepted targets: ${repositoryTargets.length}`);
    allTargets.push(...repositoryTargets);
    await writeStackOutputs(allTargets, options.outputDir);
    console.error(`wrote per-stack outputs to ${options.outputDir}`);
    await pause(1000);
  }
  await writeStackOutputs(allTargets, options.outputDir);
  const byStack = new Map<string, number>();
  for (const target of allTargets) {
    byStack.set(target.stack, (byStack.get(target.stack) ?? 0) + 1);
  }
  console.error(`Total targets: ${allTargets.length}`);
  for (const stack of [...byStack.keys()].sort()) {
    console.error(`  ${stack}: ${byStack.get(stack)}`);
  }
  return 0;
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
