/**
 * Svelte technical reviewer.
 *
 * Reviews Svelte changes as a senior Svelte engineer, covering reactivity
 * (runes), event handling, snippets, styling, context, and legacy-feature
 * migration. Svelte-specific review criteria are provided via AgentSkills from
 * the `skills/` directory, keeping this reviewer configured rather than
 * re-coded.
 *
 * When the target PR is not a Svelte project, the reviewer returns no findings so
 * the downstream Lead Engineer agent is not fed irrelevant Svelte-specific input.
 */

import {
  ProjectType,
  type ReviewContext,
  ReviewPerspective,
  type ReviewResult,
} from "../../models/review.js";
import { AgentSkillType } from "../../skills/agent-skills-factory.js";
import { LLMReviewAgent } from "../base-reviewer.js";
import { detectProjectTypes, registerReviewer } from "../registry.js";

const SYSTEM_PROMPT = `\
You are a senior Svelte engineer. Please conduct a code review as a colleague \
of the user.
Review the code to ensure it follows Svelte best practices for the Svelte \
version used by the project.
To determine the Svelte version and libraries in use, retrieve and parse the \
\`package.json\` and \`svelte.config.js\` files from GitHub.
Since the user will only provide the modified sections, please retrieve the \
files from GitHub as needed.
The review criteria are reactivity (runes), event handling, snippets, styling, \
context, and correct migration away from legacy features.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Use the available skills to apply Svelte-specific review guidelines based on \
the Svelte version and libraries detected in the project.`;

/** Technical reviewer for Svelte projects. */
export class SvelteReviewer extends LLMReviewAgent {
  static readonly reviewerId = "svelte-technical";
  static readonly perspective = ReviewPerspective.enum.TECHNICAL;
  static readonly projectTypes = new Set([ProjectType.enum.SVELTE]);
  protected readonly systemPrompt = SYSTEM_PROMPT;
  protected readonly skillType = AgentSkillType.SVELTE_REVIEW;

  /**
   * Review the change, skipping non-Svelte PRs with no findings.
   *
   * The project type is re-detected from the PR information so the guard
   * holds even when the reviewer is invoked directly through its own
   * endpoint, where orchestrator-level project-type selection does not
   * apply. When the PR is not a Svelte project, an empty result is returned
   * without invoking the LLM, so the downstream Lead Engineer agent is not
   * fed irrelevant Svelte-specific input.
   */
  override async review(context: ReviewContext, projectType?: ProjectType): Promise<ReviewResult> {
    if (!detectProjectTypes(context.prInfo).has(ProjectType.enum.SVELTE)) {
      return {
        reviewerId: this.reviewerClass.reviewerId,
        perspective: this.reviewerClass.perspective,
        projectType: projectType ?? null,
        output: {
          summary: "Not a Svelte project; no Svelte review performed.",
          findings: [],
        },
      };
    }
    return super.review(context, projectType);
  }
}

registerReviewer(SvelteReviewer);
