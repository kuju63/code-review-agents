import { ReactReviewer } from "@code-review-agent/agent-core/agents/reviewers/react.js";
import {
  createReviewerService,
  type ReviewerService,
  type ReviewerServiceOptions,
} from "./reviewer-runtime.js";

export type ReactReviewerServiceOptions = ReviewerServiceOptions<typeof ReactReviewer>;

export function createReactReviewerService(
  options: ReactReviewerServiceOptions = {},
): ReviewerService {
  return createReviewerService({
    metadata: {
      name: "React Reviewer",
      description:
        "Reviews React/TypeScript pull requests for component/Hook design, performance, and correct library usage.",
      path: "react-reviewer",
      skill: {
        id: "review_react_pr",
        name: "Review React PR",
        description:
          "Performs a technical code review for a React/TypeScript PR using GitHub MCP and framework-specific skills.",
      },
    },
    defaultReviewerClass: ReactReviewer,
    ...options,
  });
}
