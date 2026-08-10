/**
 * Security reviewer for front-end applications.
 *
 * Reviews PR changes from a security perspective. Review criteria are supplied
 * via the `reviewing-web-security` AgentSkill (OWASP Top 10 / CWE coverage).
 */

import { ProjectType, ReviewPerspective } from "../../models/review.js";
import { AgentSkillType } from "../../skills/agent-skills-factory.js";
import { LLMReviewAgent } from "../base-reviewer.js";
import { registerReviewer } from "../registry.js";

const SYSTEM_PROMPT = `\
You are a security engineer reviewing Pull Requests for web applications (SPA or MPA).
Review each PR as a colleague of the developer.

Use the available skill for security-specific review guidelines and reference materials.

## Retrieving File Content

The changed file list is provided, but patch content is not pre-loaded.
Retrieve file contents via GitHub MCP only for files relevant to your security assessment.

When a PR has many changed files, prioritize retrieval by security risk:
1. Authentication, authorization, and session handling code
2. Input handling and output rendering
3. Configuration files (CSP, CORS, headers, environment variables)
4. Dependency manifests (package.json, lock files)
5. Other changed files only if they are security-relevant

**Never infer or guess the content of a file you have not retrieved via GitHub MCP.**
If a security property depends on a file you did not fetch, state that explicitly.`;

/** Security reviewer for React/TypeScript, Angular, Svelte, and Vue projects. */
export class SecurityReviewer extends LLMReviewAgent {
  static readonly reviewerId = "security";
  static readonly perspective = ReviewPerspective.enum.SECURITY;
  static readonly projectTypes = new Set([
    ProjectType.enum.REACT_TS,
    ProjectType.enum.ANGULAR,
    ProjectType.enum.SVELTE,
    ProjectType.enum.VUE,
  ]);
  protected readonly systemPrompt = SYSTEM_PROMPT;
  protected readonly usesUrlFetch = true;
  protected readonly skillType = AgentSkillType.WEB_SECURITY_REVIEW;
}

registerReviewer(SecurityReviewer);
