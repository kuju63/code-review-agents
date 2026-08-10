/**
 * Base classes for review agents in the parallel review stage.
 *
 * Defines the reviewer interface (`ReviewAgent`) and a shared LLM-backed
 * implementation (`LLMReviewAgent`). Concrete reviewers (React technical,
 * security, future stacks/perspectives) subclass these and supply only their
 * metadata and system prompt, so behavior is configured rather than re-coded.
 */

import type { ReviewContext } from "../models/review.js";

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
