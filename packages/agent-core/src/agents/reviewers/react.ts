/**
 * React technical reviewer.
 *
 * Reviews front-end changes as a senior front-end engineer, covering component
 * design, performance, and correct library usage for React/TypeScript and related
 * metaframeworks. Angular, Svelte, and Vue changes are handled separately by
 * AngularReviewer, SvelteReviewer, and VueReviewer. Framework-specific review
 * criteria are provided via AgentSkills from the `skills/` directory.
 */

import { ProjectType, ReviewPerspective } from "../../models/review.js";
import { AgentSkillType } from "../../skills/agent-skills-factory.js";
import { LLMReviewAgent } from "../base-reviewer.js";
import { registerReviewer } from "../registry.js";

const SYSTEM_PROMPT = `\
You are a senior front-end engineer. Please conduct a code review as a \
colleague of the user.
Review the code to ensure it follows front-end best practices for the \
frameworks and libraries in use.
To obtain information about the libraries being used, retrieve and parse the \
\`package.json\` file from GitHub.
Since the user will only provide the modified sections, please retrieve the \
files from GitHub as needed.
The review criteria are component/Hook design, performance, and security.
For each finding, set its priority, describe the context of the issue, and, if \
necessary, propose a fix.

Use the available skills to apply framework-specific review guidelines based on \
the libraries and frameworks detected in the project.`;

/** Technical reviewer for React/TypeScript and related frontend projects. */
export class ReactReviewer extends LLMReviewAgent {
  static readonly reviewerId = "react-technical";
  static readonly perspective = ReviewPerspective.enum.TECHNICAL;
  static readonly projectTypes = new Set([ProjectType.enum.REACT_TS]);
  protected readonly systemPrompt = SYSTEM_PROMPT;
  protected readonly skillType = AgentSkillType.REACT_REVIEW;
}

registerReviewer(ReactReviewer);
