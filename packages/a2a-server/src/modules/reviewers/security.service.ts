import { SecurityReviewer } from "@code-review-agent/agent-core/agents/reviewers/security.js";
import {
  createReviewerService,
  type ReviewerService,
  type ReviewerServiceOptions,
} from "./reviewer-runtime.js";

export type SecurityReviewerServiceOptions = ReviewerServiceOptions<typeof SecurityReviewer>;

export function createSecurityReviewerService(
  options: SecurityReviewerServiceOptions = {},
): ReviewerService {
  return createReviewerService({
    metadata: {
      name: "Security Reviewer",
      description:
        "Reviews pull requests for security vulnerabilities based on OWASP Top 10 and front-end attack patterns.",
      path: "security-reviewer",
      skill: {
        id: "review_security",
        name: "Review Security",
        description: "Performs a security-focused code review using GitHub MCP.",
      },
    },
    defaultReviewerClass: SecurityReviewer,
    ...options,
  });
}
