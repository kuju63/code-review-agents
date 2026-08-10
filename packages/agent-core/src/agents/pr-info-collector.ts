/**
 * PR Info Collector agent.
 *
 * Collects pull request information from GitHub and returns structured data
 * for use by downstream review agents.
 *
 * Design note: the factual fields (title, body, labels, file changes) are
 * retrieved **deterministically** from the GitHub MCP server via
 * `McpClient.callTool` -- no LLM tool loop and no structured output. An LLM
 * had previously been asked to structure these facts, but a small model
 * fabricated file paths and paraphrased the title/labels even when the
 * correct data was already in context (see
 * `docs/pr-info-collector-tooluse-fix-spec.md` section 2.5, and
 * `docs/typescript-agents-tools-migration-spec.md` section 7's intro note).
 * Deterministic mapping makes file-path hallucination impossible and removes
 * the runaway tool loop. The only LLM call left is summarising the README
 * into `projectSummary`.
 *
 * Unlike the parallel review stage (`review-orchestrator.ts`), this class
 * owns its GitHub MCP client's entire lifecycle standalone -- it is never
 * shared via `SharedMcpClient` (spec doc section 7.1, ADR-0004 Decision 1).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
// GitHub repository paths are always POSIX-style regardless of the host OS
// this process runs on, so path parsing here must not depend on it.
import { basename, extname } from "node:path/posix";
import { Agent, type JSONValue, type McpClient, type Model } from "@strands-agents/sdk";
import type { FileChange, PRInfoResult } from "../models/pr-info.js";
import { createGithubMcpClient, GITHUB_MCP_URL } from "../tools/github-mcp.js";
import type { ReviewerConfig } from "./base-reviewer.js";
import { isInfraError } from "./exceptions.js";
import { extractDirectDependenciesFromPackageJson } from "./manifest-detection.js";
import { createModelProvider, ProviderType } from "./model-provider-factory.js";

const SUMMARY_SYSTEM_PROMPT = `\
You are given the README of a software project. Summarise what the project is \
and what it does in 2-4 concise sentences of plain prose. Base the summary only \
on the provided README text; do not invent facts. Output the summary text only, \
with no preamble, headings, or markdown.`;

const TARGET_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".scss",
  ".html",
  ".svelte",
  ".vue",
]);
const TARGET_FILENAMES = new Set([
  "package.json",
  "angular.json",
  "svelte.config.js",
  "svelte.config.ts",
  "vue.config.js",
  "vue.config.ts",
]);
const DEPENDENCY_FILENAMES = new Set([
  "package.json",
  "angular.json",
  "svelte.config.js",
  "svelte.config.ts",
  "vue.config.js",
  "vue.config.ts",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "requirements.txt",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
]);

// Manifest content fetched for stack detection (Issue #230). yarn.lock is
// deliberately excluded: its v1 format mixes direct and transitive
// dependencies with no way to tell them apart from the file alone.
const ROOT_PACKAGE_JSON = "package.json";
const LOCKFILE_CONTENT_NAMES = ["package-lock.json", "pnpm-lock.yaml"] as const;
// Bounds on workspace resolution to cap GitHub MCP calls against a
// `workspaces` declaration with many glob patterns or matched packages.
const MAX_WORKSPACE_GLOBS = 10;
const MAX_WORKSPACE_PACKAGES = 20;

// README is truncated before summarisation to keep the single LLM call cheap
// and within context limits for small local models.
const README_MAX_CHARS = 6000;
// GitHub MCP `get_files` is paginated; request large pages and loop until a
// short page signals the end so large PRs are covered comprehensively.
const FILES_PER_PAGE = 100;

const PATCH_TOTAL_CHAR_LIMIT_DEFAULT = 30_000;
const PATCH_MAX_FILES_DEFAULT = 30;

/** Additional settings for {@link PRInfoCollector}, layered on the fields `ReviewerConfig` already declares. */
export interface PRInfoCollectorConfig extends ReviewerConfig {
  /**
   * Maximum combined patch size (characters) across target files before
   * patches are omitted in favor of `patch: null`. Defaults to `30000`.
   */
  patchTotalCharLimit?: number;
  /**
   * Maximum number of target files before patches are omitted in favor of
   * `patch: null`. Defaults to `30`.
   */
  patchMaxFiles?: number;
}

/**
 * Return true if the file should be included in the review.
 *
 * Includes TypeScript/JavaScript, CSS/SCSS, HTML, Svelte, Vue, and
 * package.json-family files.
 */
export function isTargetFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  const filename = basename(filePath);
  return TARGET_EXTENSIONS.has(ext) || TARGET_FILENAMES.has(filename);
}

/** Return true if the file is a dependency manifest or lock file. */
export function isDependencyFile(filePath: string): boolean {
  return DEPENDENCY_FILENAMES.has(basename(filePath));
}

function isPlainRecord(value: unknown): value is Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalise a PR `labels` field into a list of label name strings.
 *
 * The GitHub MCP `pull_request_read` `get` method returns labels as plain
 * strings (`["scope: progress"]`), whereas the REST API shape is a list of
 * objects (`[{"name": ...}]`). Both are accepted so the mapping does not
 * depend on which shape the endpoint happens to return.
 */
function extractLabelNames(labels: JSONValue): string[] {
  const names: string[] = [];
  for (const label of Array.isArray(labels) ? labels : []) {
    if (typeof label === "string") {
      names.push(label);
    } else if (isPlainRecord(label) && typeof label.name === "string" && label.name) {
      names.push(label.name);
    }
  }
  return names;
}

/** Return the PR head commit SHA (or ref) to pin "point in time" reads, or `undefined`. */
function extractHeadRef(prDetails: Record<string, JSONValue>): string | undefined {
  const head = prDetails.head;
  if (isPlainRecord(head)) {
    const sha = typeof head.sha === "string" ? head.sha : undefined;
    const ref = typeof head.ref === "string" ? head.ref : undefined;
    return sha || ref || undefined;
  }
  return undefined;
}

/**
 * Extract the text payloads from an MCP tool result.
 *
 * @throws Error if the tool reported an error (`isError: true`).
 */
function extractToolTextBlocks(result: JSONValue): string[] {
  if (!isPlainRecord(result)) {
    return [];
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content
    .filter(isPlainRecord)
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter((text): text is string => text.length > 0);
  if (result.isError) {
    throw new Error(`GitHub MCP tool error: ${texts.join(" ") || "unknown"}`);
  }
  return texts;
}

type McpToolInstance = Awaited<ReturnType<McpClient["listTools"]>>[number];
type CallMcpTool = (name: string, args: Record<string, JSONValue>) => Promise<string[]>;

/**
 * Resolves MCP tool names to `McpTool` instances once (via `listTools()`)
 * and returns a helper that calls a tool by its server-side name.
 *
 * Unlike Python's `MCPClient.call_tool_sync(name, args)`, the TS SDK's
 * `McpClient.callTool(tool, args)` requires an `McpTool` instance rather
 * than a name string (spec doc section 7.3) -- this closure bridges that gap
 * so the rest of this module can call tools by name, as Python does.
 */
function createMcpToolCaller(mcpClient: McpClient, tools: McpToolInstance[]): CallMcpTool {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool] as const));
  return async (name, args) => {
    const tool = toolsByName.get(name);
    if (!tool) {
      throw new Error(`GitHub MCP tool not found: ${name}`);
    }
    return extractToolTextBlocks(await mcpClient.callTool(tool, args));
  };
}

/**
 * Collects PR information from GitHub deterministically.
 *
 * Retrieves PR details and the changed-file list directly from the GitHub
 * MCP server (no LLM tool loop), maps them onto a `PRInfoResult`, and uses a
 * single tool-free LLM call only to summarise the project README.
 */
export class PRInfoCollector {
  constructor(private readonly config: PRInfoCollectorConfig) {}

  /**
   * Collect PR information from GitHub and return structured data.
   *
   * Connects to the GitHub MCP endpoint, retrieves the PR details, the full
   * changed-file list, and the README deterministically, then maps them onto
   * a `PRInfoResult`. File changes are filtered so only review-relevant
   * files (see `isTargetFile`) are kept. The README is summarised with a
   * single tool-free LLM call.
   *
   * @throws An infrastructure-level error (model connection lost, GitHub MCP
   *   client init failure) when `isInfraError` classifies it as such, rather
   *   than a business-level failure. Collection is not guaranteed to have
   *   completed when this is thrown.
   */
  async collect(owner: string, repository: string, prNumber: number): Promise<PRInfoResult> {
    const mcpClient = createGithubMcpClient(
      this.config.githubToken,
      this.config.mcpUrl ?? GITHUB_MCP_URL,
      {
        retryAttempts: this.config.mcpStartupRetryAttempts ?? 3,
        retryBackoffSeconds: this.config.mcpStartupRetryBackoffSeconds ?? 1,
      },
    );

    let prDetails: Record<string, JSONValue>;
    let headRef: string | undefined;
    let changedFiles: Record<string, JSONValue>[];
    let readmeText: string | undefined;
    let dependencyFiles: string[];
    let manifestContents: Record<string, string>;
    // Used standalone (not via Agent's `tools` array), we own the client's
    // lifecycle. connect() runs inside the try so a failing connect (e.g.
    // auth error, exhausted retries) still reaches finally and disconnects;
    // disconnect() is safe to call even when connect() never completed.
    try {
      await mcpClient.connect();
      const tools = await mcpClient.listTools();
      const callTool = createMcpToolCaller(mcpClient, tools);

      prDetails = await this.readPrDetails(callTool, owner, repository, prNumber);
      // Pin all repo-content reads to the PR head commit so the result is
      // reproducible and reflects this PR's point in time (rather than the
      // moving default branch).
      headRef = extractHeadRef(prDetails);
      changedFiles = await this.readChangedFiles(callTool, owner, repository, prNumber);
      readmeText = await this.readReadme(callTool, owner, repository, headRef);
      // `dependencyFiles` describes the packages the project depends on so
      // downstream reviewers know the dependency context. It is the set of
      // manifest files present in the repo at this PR's point in time -- NOT
      // only the manifests changed by the PR -- so we list the repo root at
      // the PR head ref rather than deriving from changed files.
      dependencyFiles = await this.readDependencyFiles(callTool, owner, repository, headRef);
      // Content-based stack detection (Issue #230) needs the actual text of
      // package.json/lock files, not just their paths.
      manifestContents = await this.readManifestContents(
        callTool,
        owner,
        repository,
        headRef,
        dependencyFiles,
      );
    } finally {
      await mcpClient.disconnect();
    }

    // The README summary is the only non-deterministic step. It must never
    // discard the deterministically-fetched facts: if the summary itself is
    // rejected or malformed, fall back to an empty summary rather than
    // failing the whole collect(). Infra failures (model connection lost,
    // etc.) are re-thrown instead -- they signal the shared model connection
    // is down, which the downstream review stage relying on the same
    // connection needs to know about rather than silently proceed.
    let projectSummary = "";
    if (readmeText) {
      try {
        projectSummary = await this.summarizeReadme(readmeText);
      } catch (error) {
        if (isInfraError(error)) {
          throw error;
        }
        projectSummary = "";
      }
    }

    // Include patch in FileChange when the total diff size is within limits.
    // Providing patches upfront lets reviewers skip GitHub MCP fetches. When
    // total diff exceeds limits, fall back to patch=null so reviewers can
    // still fetch diffs via MCP.
    const targetFiles = changedFiles.filter((f) =>
      isTargetFile(typeof f.filename === "string" ? f.filename : ""),
    );
    const patchMaxFiles = this.config.patchMaxFiles ?? PATCH_MAX_FILES_DEFAULT;
    const patchTotalCharLimit = this.config.patchTotalCharLimit ?? PATCH_TOTAL_CHAR_LIMIT_DEFAULT;
    const totalPatchChars = targetFiles.reduce(
      (sum, f) => sum + (typeof f.patch === "string" ? f.patch.length : 0),
      0,
    );
    const includePatches =
      targetFiles.length <= patchMaxFiles && totalPatchChars <= patchTotalCharLimit;
    if (!includePatches) {
      console.warn(
        `PR diff exceeds context limit (${totalPatchChars} chars across ` +
          `${targetFiles.length} files): falling back to patch=null. ` +
          "Reviewers will fetch diffs via GitHub MCP.",
      );
    }
    const fileChanges: FileChange[] = targetFiles.map((f) => ({
      filePath: typeof f.filename === "string" ? f.filename : "",
      patch: includePatches && typeof f.patch === "string" ? f.patch : null,
    }));

    const result: PRInfoResult = {
      repositoryInfo: { owner, repository },
      projectSummary,
      prInfo: {
        title: typeof prDetails.title === "string" ? prDetails.title : "",
        prNumber: typeof prDetails.number === "number" ? prDetails.number : prNumber,
        body: typeof prDetails.body === "string" ? prDetails.body : null,
        labels: extractLabelNames(prDetails.labels ?? []),
        fileChanges,
      },
      dependencyFiles,
      manifestContents,
    };

    this.writeDebugResponseFile(result);
    return result;
  }

  /**
   * Writes the collected result to `PR_INFO_COLLECTOR_RESPONSE_FILE` when
   * set, purely as a local debugging aid. A write failure never fails
   * collection -- it is logged as a warning only.
   */
  private writeDebugResponseFile(result: PRInfoResult): void {
    const outputPath = process.env.PR_INFO_COLLECTOR_RESPONSE_FILE;
    if (!outputPath) {
      return;
    }
    try {
      const parent = dirname(outputPath);
      if (parent && parent !== ".") {
        mkdirSync(parent, { recursive: true });
      }
      writeFileSync(outputPath, JSON.stringify(result), "utf-8");
    } catch (error) {
      console.warn(`Failed to write PR collector response to ${outputPath}: ${String(error)}`);
    }
  }

  /**
   * Fetch PR metadata (title, body, labels, number) deterministically.
   *
   * @returns The parsed `pull_request_read` `get` payload, or `{}` if the
   *   tool returned no text content.
   */
  private async readPrDetails(
    callTool: CallMcpTool,
    owner: string,
    repository: string,
    prNumber: number,
  ): Promise<Record<string, JSONValue>> {
    const texts = await callTool("pull_request_read", {
      method: "get",
      owner,
      repo: repository,
      pullNumber: prNumber,
    });
    const firstText = texts.at(0);
    if (firstText === undefined) {
      return {};
    }
    const parsed: unknown = JSON.parse(firstText);
    return isPlainRecord(parsed) ? parsed : {};
  }

  /**
   * Fetch the full changed-file list, paging until exhausted.
   *
   * @returns The raw changed-file entries (as returned by `get_files`)
   *   across all pages, in page order.
   */
  private async readChangedFiles(
    callTool: CallMcpTool,
    owner: string,
    repository: string,
    prNumber: number,
  ): Promise<Record<string, JSONValue>[]> {
    const files: Record<string, JSONValue>[] = [];
    let page = 1;
    for (;;) {
      const texts = await callTool("pull_request_read", {
        method: "get_files",
        owner,
        repo: repository,
        pullNumber: prNumber,
        page,
        perPage: FILES_PER_PAGE,
      });
      const firstText = texts.at(0);
      const parsed: unknown = firstText !== undefined ? JSON.parse(firstText) : [];
      const batch: unknown[] = Array.isArray(parsed) ? parsed : [];
      if (batch.length === 0) {
        break;
      }
      files.push(...batch.filter(isPlainRecord));
      if (batch.length < FILES_PER_PAGE) {
        break;
      }
      page += 1;
    }
    return files;
  }

  /**
   * List the raw `get_file_contents` directory entries at `path`.
   *
   * Shared by `readDependencyFiles` (repo root, filtered to manifest files)
   * and workspace resolution (a workspace glob's parent directory, filtered
   * to subdirectories). Infra failures are re-thrown rather than degraded to
   * an empty list.
   *
   * @returns The raw entry objects as returned by the GitHub MCP server, or
   *   an empty list if the listing is unavailable or unparseable.
   */
  private async listDirectoryEntries(
    callTool: CallMcpTool,
    owner: string,
    repository: string,
    ref: string | undefined,
    path: string,
  ): Promise<Record<string, JSONValue>[]> {
    const args: Record<string, JSONValue> = { owner, repo: repository, path };
    if (ref) {
      args.ref = ref;
    }
    let texts: string[];
    try {
      texts = await callTool("get_file_contents", args);
    } catch (error) {
      if (isInfraError(error)) {
        throw error;
      }
      return [];
    }
    const lastText = texts.at(-1);
    if (lastText === undefined) {
      return [];
    }
    try {
      const entries: unknown = JSON.parse(lastText);
      return Array.isArray(entries) ? entries.filter(isPlainRecord) : [];
    } catch {
      return [];
    }
  }

  /**
   * List dependency manifest files at the repo root for the given ref.
   *
   * Returns the paths of dependency manifests (see `isDependencyFile`)
   * present at the repository root at `ref`, describing the project's
   * dependency context regardless of whether the PR changed them.
   *
   * @returns Sorted paths of dependency manifest files at the repo root, or
   *   an empty list if the listing is unavailable or unparseable.
   */
  private async readDependencyFiles(
    callTool: CallMcpTool,
    owner: string,
    repository: string,
    ref: string | undefined,
  ): Promise<string[]> {
    const entries = await this.listDirectoryEntries(callTool, owner, repository, ref, "/");
    const paths = entries
      .filter(
        (entry) =>
          entry.type === "file" &&
          isDependencyFile(typeof entry.path === "string" ? entry.path : ""),
      )
      .map((entry) => entry.path as string);
    // Sort for deterministic output regardless of server-side listing order.
    return paths.sort();
  }

  /**
   * Fetch a repository file's text content at `ref`, or `undefined`.
   *
   * Shared by README, `package.json`, and lock-file/workspace-manifest
   * fetches -- they all call the same `get_file_contents` tool and return
   * its last text block. Infra failures are re-thrown rather than degraded
   * to `undefined`.
   *
   * @returns The file's text content at `ref`, or `undefined` if unavailable.
   */
  private async readFileText(
    callTool: CallMcpTool,
    owner: string,
    repository: string,
    ref: string | undefined,
    path: string,
  ): Promise<string | undefined> {
    const args: Record<string, JSONValue> = { owner, repo: repository, path };
    if (ref) {
      args.ref = ref;
    }
    let texts: string[];
    try {
      texts = await callTool("get_file_contents", args);
    } catch (error) {
      if (isInfraError(error)) {
        throw error;
      }
      return undefined;
    }
    return texts.at(-1);
  }

  /**
   * Resolve a root `package.json`'s `workspaces` field to paths.
   *
   * Supports the common workspace declaration shapes -- a plain glob array
   * (npm/pnpm) and yarn's `{"packages": [...]}` object form. Only exact
   * paths and a single trailing `/*` wildcard are resolved; nested or
   * multi-segment globs are skipped (documented limitation, see
   * docs/review-agents-design.md). Resolution is bounded by
   * `MAX_WORKSPACE_GLOBS` and `MAX_WORKSPACE_PACKAGES` to cap GitHub MCP
   * calls against workspace declarations with many packages.
   *
   * @returns Sorted, de-duplicated `{workspaceDir}/package.json` paths, or
   *   an empty list if `workspaces` is absent or unparseable.
   */
  private async resolveWorkspacePackageJsonPaths(
    callTool: CallMcpTool,
    owner: string,
    repository: string,
    ref: string | undefined,
    rootPackageJsonText: string,
  ): Promise<string[]> {
    let data: unknown;
    try {
      data = JSON.parse(rootPackageJsonText);
    } catch {
      return [];
    }
    if (!isPlainRecord(data)) {
      return [];
    }
    let workspaces: unknown = data.workspaces;
    if (isPlainRecord(workspaces)) {
      workspaces = workspaces.packages;
    }
    if (!Array.isArray(workspaces)) {
      return [];
    }
    const patterns = workspaces.filter((p): p is string => typeof p === "string");

    const resolvedDirs = new Set<string>();
    for (const pattern of patterns.slice(0, MAX_WORKSPACE_GLOBS)) {
      // Reject path-traversal-looking or absolute patterns outright, rather
      // than forwarding them as a GitHub MCP `path` argument.
      if (pattern.includes("..") || pattern.startsWith("/")) {
        continue;
      }
      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -"/*".length);
        const entries = await this.listDirectoryEntries(callTool, owner, repository, ref, prefix);
        for (const entry of entries) {
          if (entry.type === "dir" && typeof entry.path === "string" && entry.path) {
            resolvedDirs.add(entry.path);
          }
        }
      } else if (!pattern.includes("*")) {
        resolvedDirs.add(pattern);
      }
      // Nested/multi-wildcard globs (e.g. "packages/**") are not supported
      // and are silently skipped.
    }

    return [...resolvedDirs]
      .sort()
      .slice(0, MAX_WORKSPACE_PACKAGES)
      .map((workspaceDir) => `${workspaceDir}/package.json`);
  }

  /**
   * Fetch the text content of manifests used for stack detection.
   *
   * Fetches `package.json` when GitHub reports it present at the repo root
   * (`dependencyFiles`), plus each workspace package's `package.json`
   * resolved from the root manifest's `workspaces` field. Lock files
   * (`package-lock.json`, `pnpm-lock.yaml`) are fetched only as a fallback,
   * when no fetched `package.json` (root or workspace) yielded any direct
   * dependency name -- matching `collectDirectPackageNames`'s own fallback
   * condition exactly, rather than the coarser "package.json was readable at
   * all". `yarn.lock` is intentionally never fetched: its v1 format mixes
   * direct and transitive dependencies with no way to tell them apart.
   *
   * A manifest that fails to fetch (missing, transient error) is simply
   * omitted rather than failing the whole collection.
   *
   * @returns Mapping of repository-relative manifest path to its raw text
   *   content, for every manifest that was fetched successfully.
   */
  private async readManifestContents(
    callTool: CallMcpTool,
    owner: string,
    repository: string,
    ref: string | undefined,
    dependencyFiles: string[],
  ): Promise<Record<string, string>> {
    const contents: Record<string, string> = {};
    const dependencyFileSet = new Set(dependencyFiles);
    const packageJsonNames = new Set<string>();

    if (dependencyFileSet.has(ROOT_PACKAGE_JSON)) {
      const rootPackageJsonText = await this.readFileText(
        callTool,
        owner,
        repository,
        ref,
        ROOT_PACKAGE_JSON,
      );
      if (rootPackageJsonText !== undefined) {
        contents[ROOT_PACKAGE_JSON] = rootPackageJsonText;
        for (const name of extractDirectDependenciesFromPackageJson(rootPackageJsonText)) {
          packageJsonNames.add(name);
        }
        const workspacePaths = await this.resolveWorkspacePackageJsonPaths(
          callTool,
          owner,
          repository,
          ref,
          rootPackageJsonText,
        );
        for (const workspacePath of workspacePaths) {
          const text = await this.readFileText(callTool, owner, repository, ref, workspacePath);
          if (text !== undefined) {
            contents[workspacePath] = text;
            for (const name of extractDirectDependenciesFromPackageJson(text)) {
              packageJsonNames.add(name);
            }
          }
        }
      }
    }

    if (packageJsonNames.size === 0) {
      for (const lockName of LOCKFILE_CONTENT_NAMES) {
        if (dependencyFileSet.has(lockName)) {
          const text = await this.readFileText(callTool, owner, repository, ref, lockName);
          if (text !== undefined) {
            contents[lockName] = text;
          }
        }
      }
    }

    return contents;
  }

  /**
   * Fetch the repository README text at `ref`, or `undefined` if unavailable.
   *
   * Pinning to the PR head ref keeps `projectSummary` reproducible and
   * reflects README changes made on the PR branch rather than the moving
   * default branch.
   */
  private async readReadme(
    callTool: CallMcpTool,
    owner: string,
    repository: string,
    ref: string | undefined,
  ): Promise<string | undefined> {
    return this.readFileText(callTool, owner, repository, ref, "README.md");
  }

  /** Build the model for README summarisation. */
  private buildModel(): Model {
    return createModelProvider(
      this.config.providerType ?? ProviderType.OPENAI,
      this.config.modelId ?? "gpt-4o",
      { llmBaseUrl: this.config.llmBaseUrl, temperature: 0.3 },
    );
  }

  /** Summarise the README with a single tool-free LLM call. */
  private async summarizeReadme(readmeText: string): Promise<string> {
    const agent = new Agent({ model: this.buildModel(), systemPrompt: SUMMARY_SYSTEM_PROMPT });
    const result = await agent.invoke(readmeText.slice(0, README_MAX_CHARS), {
      limits: { turns: this.config.maxAgentTurns ?? 30 },
    });
    return result.toString().trim();
  }
}
