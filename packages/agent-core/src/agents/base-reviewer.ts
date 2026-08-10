/**
 * Base classes for review agents in the parallel review stage.
 *
 * Defines the reviewer interface (`ReviewAgent`) and a shared LLM-backed
 * implementation (`LLMReviewAgent`). Concrete reviewers (React technical,
 * security, future stacks/perspectives) subclass these and supply only their
 * metadata and system prompt, so behavior is configured rather than re-coded.
 */

import type { McpClient } from "@strands-agents/sdk";
import { Agent, type Plugin } from "@strands-agents/sdk";
import { httpRequest } from "@strands-agents/sdk/vended-tools/http-request";
import {
  type ProjectType,
  type ReviewContext,
  type ReviewOutput,
  ReviewOutputSchema,
  type ReviewPerspective,
  type ReviewResult,
} from "../models/review.js";
import { AgentSkillType, createAgentSkills } from "../skills/agent-skills-factory.js";
import { createFileReadTool } from "../tools/file-read-tool.js";
import { createGithubMcpClient, GITHUB_MCP_URL } from "../tools/github-mcp.js";
import { OllamaUnsupportedContentSanitizer } from "../tools/tool-result-sanitizer.js";
import { StructuredOutputMissingError } from "./exceptions.js";
import { createModelProvider, ProviderType } from "./model-provider-factory.js";

// Small models sometimes end their turn with a free-form Markdown review
// report instead of invoking the forced structured-output tool, which the SDK
// surfaces as `AgentResult.structuredOutput === undefined` with
// `stopReason: "limitTurns"` rather than throwing. This directive is appended
// to every LLM reviewer's system prompt (via `composeSystemPrompt`) to steer
// the model toward emitting the structured tool call as its final action
// rather than prose.
export const STRUCTURED_OUTPUT_DIRECTIVE = `\
## Output format (mandatory)

Do NOT write a prose or Markdown review report. Do not produce headings, tables, \
summaries, or narrative text as your final answer.

Use tools only to gather the information you need. Once you have gathered enough \
information, your single final action MUST be to return your findings as the \
structured output. Emit the structured output directly; do not restate it as \
prose first. If you have no findings, return an empty structured result rather \
than writing an explanation.

For every finding tied to a specific place in the diff, you MUST also set that \
finding's \`filePath\` and \`line\` fields to that location. Mentioning the file or \
line only in \`comment\`/\`context\` is not enough: a finding whose \`filePath\` or \
\`line\` is left unset is silently dropped before it reaches the user, no matter \
how well-reasoned it is. Leave \`filePath\`/\`line\` unset only for findings that \
are genuinely not tied to one place in the diff.`;

/**
 * Combine a reviewer's role prompt with the shared structured-output directive.
 *
 * Output format is a cross-cutting concern shared by every LLM reviewer, so it
 * lives here rather than being duplicated into each reviewer's prompt constant.
 */
export function composeSystemPrompt(systemPrompt: string): string {
  return `${systemPrompt}\n\n${STRUCTURED_OUTPUT_DIRECTIVE}`;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Split a unified diff into lines, mirroring Python's `str.splitlines()`:
 * an empty string yields no lines, and a single trailing line terminator
 * does not produce a trailing empty element. CRLF/CR are normalized to LF.
 */
function splitPatchLines(patch: string): string[] {
  if (patch === "") {
    return [];
  }
  const lines = patch.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "" && /[\r\n]$/.test(patch)) {
    lines.pop();
  }
  return lines;
}

/**
 * Annotate each line of a unified diff with its actual file line number.
 *
 * Transforms raw unified diff lines into annotated form so the LLM can
 * report accurate file-absolute line numbers in its findings:
 *
 *     @@ -228,3 +224,4 @@       →  @@ -228,3 +224,4 @@
 *     -old line                  →  -L228:old line
 *     +new line                  →  +L224:new line
 *      context                   →   L225:context
 *
 * Legend:
 *   "+L{N}:" — line N added in the new file.
 *   " L{N}:" — line N unchanged (context) in the new file.
 *   "-L{N}:" — line N removed from the old file (absent in new file).
 */
export function annotatePatch(patch: string): string {
  const result: string[] = [];
  let newLine = 0;
  let oldLine = 0;

  for (const raw of splitPatchLines(patch)) {
    const match = HUNK_HEADER_RE.exec(raw);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      result.push(raw);
    } else if (raw.startsWith("+")) {
      result.push(`+L${newLine}:${raw.slice(1)}`);
      newLine += 1;
    } else if (raw.startsWith("-")) {
      result.push(`-L${oldLine}:${raw.slice(1)}`);
      oldLine += 1;
    } else if (raw.startsWith(" ")) {
      result.push(` L${newLine}:${raw.slice(1)}`);
      newLine += 1;
      oldLine += 1;
    } else {
      result.push(raw);
    }
  }

  return result.join("\n");
}

/**
 * Serialize the review-relevant PR information into a prompt.
 *
 * Shared by every LLM reviewer so the perspective-specific guidance lives
 * only in the system prompt, not in input formatting.
 */
export function buildPrompt(context: ReviewContext): string {
  const pr = context.prInfo;
  const repo = pr.repositoryInfo;
  const lines: string[] = [
    `Repository: ${repo.owner}/${repo.repository}`,
    `Project summary: ${pr.projectSummary}`,
    "",
    `PR #${pr.prInfo.prNumber}: ${pr.prInfo.title}`,
    `Body: ${pr.prInfo.body || "(none)"}`,
    `Labels: ${pr.prInfo.labels.join(", ") || "(none)"}`,
    `Dependency files: ${pr.dependencyFiles.join(", ") || "(none)"}`,
    "",
    "Changed files (diff patches):",
  ];

  const hasAnnotated = pr.prInfo.fileChanges.some((change) => change.patch);
  if (hasAnnotated) {
    lines.push(
      "Each diff line is prefixed with its actual file line number:",
      "  +L{N}: line N added in the new file",
      "  -L{N}: line N removed from the old file (absent in the new file)",
      "   L{N}: line N unchanged (context) in the new file",
      "When reporting a finding, use the L{N} value as the line number.",
      "",
    );
  }

  for (const change of pr.prInfo.fileChanges) {
    lines.push(`--- ${change.filePath} ---`);
    lines.push(
      change.patch ? annotatePatch(change.patch) : "(patch unavailable; fetch via GitHub)",
    );
  }

  // Known limitation: patches fetched on-demand via GitHub MCP during agent
  // execution are not annotated and may yield inaccurate line numbers.
  lines.push(
    "",
    "Only the modified sections are provided. Retrieve full files from GitHub as needed.",
  );

  return lines.join("\n");
}

/**
 * Shared runtime configuration injected into each reviewer.
 *
 * Only `githubToken` is required; every other field has a default applied at
 * its point of use in `LLMReviewAgent.review()`, mirroring Python's frozen
 * dataclass defaults.
 */
export interface ReviewerConfig {
  /** GitHub token used for the GitHub MCP `Authorization` header. */
  githubToken: string;
  /** OpenAI-compatible model ID used by every reviewer. Defaults to `"gpt-4o"`. */
  modelId?: string;
  /** GitHub MCP endpoint URL. Defaults to {@link GITHUB_MCP_URL}. */
  mcpUrl?: string;
  llmBaseUrl?: string;
  /** Which backend `createModelProvider` builds the model against. Defaults to `"openai"`. */
  providerType?: ProviderType;
  /** Maximum agent loop iterations per invocation. Defaults to `30`. */
  maxAgentTurns?: number;
  /** Maximum tokens the model may generate in a single completion. Unset disables the cap. */
  maxTokens?: number;
  /** OpenAI-compatible frequency penalty (-2.0 to 2.0). Unset omits it. */
  frequencyPenalty?: number;
  /**
   * Wall-clock timeout in seconds for the full concurrent batch of
   * reviewers. Not consumed here -- only by the review orchestrator (slice C).
   */
  reviewerTimeoutSeconds?: number;
  /** Maximum GitHub MCP startup attempts (including the first). Defaults to `3`. */
  mcpStartupRetryAttempts?: number;
  /** Base wait time in seconds for the startup retry's exponential backoff+jitter. Defaults to `1`. */
  mcpStartupRetryBackoffSeconds?: number;
}

/**
 * Constructor + registry-selection-metadata shape every concrete reviewer
 * class must satisfy. Declared as `static readonly` on each concrete class
 * (not on `ReviewAgent` itself) so `registry.ts` can select reviewers by
 * class -- without instantiating them -- purely against this interface.
 */
export interface ReviewerClass<T extends ReviewAgent = ReviewAgent> {
  new (config: ReviewerConfig): T;
  readonly reviewerId: string;
  readonly perspective: ReviewPerspective;
  readonly projectTypes: ReadonlySet<ProjectType>;
}

/**
 * Interface for a reviewer in the parallel review stage.
 *
 * Subclasses declare their identity and scope via `static readonly`
 * properties satisfying {@link ReviewerClass} and implement `review()`. The
 * registry indexes reviewers by perspective x project types; the
 * orchestrator instantiates them with a {@link ReviewerConfig} and runs
 * `review()` concurrently.
 */
export abstract class ReviewAgent {
  constructor(protected readonly config: ReviewerConfig) {}

  /** This instance's own class, typed with its registry-selection metadata. */
  protected get reviewerClass(): ReviewerClass {
    return this.constructor as ReviewerClass;
  }

  /** Review the change described by `context`. */
  abstract review(context: ReviewContext, projectType?: ProjectType): Promise<ReviewResult>;
}

/**
 * LLM-backed reviewer using a Strands `Agent` and GitHub MCP.
 *
 * Concrete reviewers set `systemPrompt` (and optionally toggle
 * `usesGithubMcp`/`usesUrlFetch`/`skillType`).
 */
export abstract class LLMReviewAgent extends ReviewAgent {
  protected abstract readonly systemPrompt: string;
  protected readonly usesGithubMcp: boolean = true;
  protected readonly usesUrlFetch: boolean = false;
  protected readonly skillType: AgentSkillType = AgentSkillType.NONE;

  /**
   * Run this reviewer's Strands `Agent` against `context` and collect its output.
   *
   * Builds the prompt, wires the GitHub MCP client (shared or per-reviewer)
   * and any configured skill plugin, then forces the agent to emit a
   * `ReviewOutput` via `structuredOutputSchema`.
   *
   * Unlike Python's `agent.cleanup()`, the TS SDK's `Agent` has no cleanup
   * method at all, so MCP client cleanup ownership lives entirely in this
   * method's `finally` block (spec doc section 4.2): a shared client
   * (`context.sharedMcpClient`) is never disconnected here -- that is the
   * caller's (orchestrator's) responsibility -- while a client this call
   * created itself is always disconnected.
   */
  async review(context: ReviewContext, projectType?: ProjectType): Promise<ReviewResult> {
    const prompt = buildPrompt(context);
    const providerType = this.config.providerType ?? ProviderType.OPENAI;
    const model = createModelProvider(providerType, this.config.modelId ?? "gpt-4o", {
      llmBaseUrl: this.config.llmBaseUrl,
      temperature: 0.1,
      maxTokens: this.config.maxTokens,
      frequencyPenalty: this.config.frequencyPenalty,
    });

    const tools: (McpClient | ReturnType<typeof createFileReadTool> | typeof httpRequest)[] = [];
    let mcpClient: McpClient | undefined;
    let ownsMcpClient = false;
    if (this.usesGithubMcp) {
      if (context.sharedMcpClient) {
        mcpClient = context.sharedMcpClient;
      } else {
        mcpClient = createGithubMcpClient(
          this.config.githubToken,
          this.config.mcpUrl ?? GITHUB_MCP_URL,
          {
            retryAttempts: this.config.mcpStartupRetryAttempts ?? 3,
            retryBackoffSeconds: this.config.mcpStartupRetryBackoffSeconds ?? 1,
          },
        );
        ownsMcpClient = true;
      }
      tools.push(mcpClient);
    }

    if (this.usesUrlFetch) {
      tools.push(httpRequest);
    }

    const plugins: Plugin[] = [];
    if (this.skillType !== AgentSkillType.NONE) {
      tools.push(createFileReadTool());
      plugins.push(createAgentSkills(this.skillType));
    }

    if (providerType === ProviderType.OLLAMA) {
      plugins.push(new OllamaUnsupportedContentSanitizer());
    }

    try {
      const agent = new Agent({
        model,
        systemPrompt: composeSystemPrompt(this.systemPrompt),
        tools,
        plugins,
      });

      const result = await agent.invoke(prompt, {
        structuredOutputSchema: ReviewOutputSchema,
        limits: { turns: this.config.maxAgentTurns ?? 30 },
      });

      if (result.structuredOutput === undefined) {
        throw new StructuredOutputMissingError(
          `Reviewer '${this.reviewerClass.reviewerId}'`,
          result.stopReason,
        );
      }

      return {
        reviewerId: this.reviewerClass.reviewerId,
        perspective: this.reviewerClass.perspective,
        projectType: projectType ?? null,
        output: result.structuredOutput as ReviewOutput,
      };
    } finally {
      if (ownsMcpClient && mcpClient) {
        await mcpClient.disconnect();
      }
    }
  }
}
