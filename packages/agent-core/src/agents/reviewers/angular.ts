/**
 * Angular technical reviewer.
 *
 * Reviews Angular changes as a senior Angular engineer, covering component and
 * service design, reactivity (signals), change detection, dependency injection,
 * and template correctness. Angular-specific review criteria are provided via
 * AgentSkills from the `skills/` directory, keeping this reviewer configured
 * rather than re-coded.
 */

import { ProjectType, ReviewPerspective } from "../../models/review.js";
import { AgentSkillType } from "../../skills/agent-skills-factory.js";
import { LLMReviewAgent } from "../base-reviewer.js";
import { registerReviewer } from "../registry.js";

const SYSTEM_PROMPT = `\
You are a senior Angular engineer. Please conduct a code review as a colleague \
of the user.
Review the code to ensure it follows Angular best practices for the Angular \
version used by the project.
To determine the Angular version and libraries in use, retrieve and parse the \
\`package.json\` file from GitHub.
Since the user will only provide the modified sections, please retrieve the \
files from GitHub as needed.
The review criteria are component/service design, reactivity (signals), change \
detection, dependency injection, and template correctness.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Use the available skills to apply Angular-specific review guidelines based on \
the Angular version and libraries detected in the project.`;

/** Technical reviewer for Angular projects. */
export class AngularReviewer extends LLMReviewAgent {
  static readonly reviewerId = "angular-technical";
  static readonly perspective = ReviewPerspective.enum.TECHNICAL;
  static readonly projectTypes = new Set([ProjectType.enum.ANGULAR]);
  protected readonly systemPrompt = SYSTEM_PROMPT;
  protected readonly skillType = AgentSkillType.ANGULAR_REVIEW;
}

registerReviewer(AngularReviewer);
