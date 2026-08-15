import { AngularReviewer } from "@code-review-agent/agent-core/agents/reviewers/angular.js";
import {
  createReviewerService,
  type ReviewerService,
  type ReviewerServiceOptions,
} from "./reviewer-runtime.js";

export type AngularReviewerServiceOptions = ReviewerServiceOptions<typeof AngularReviewer>;

export function createAngularReviewerService(
  options: AngularReviewerServiceOptions = {},
): ReviewerService {
  return createReviewerService({
    metadata: {
      name: "Angular Reviewer",
      description:
        "Reviews Angular pull requests for component/service design, reactivity, dependency injection, and template correctness.",
      path: "angular-reviewer",
      skill: {
        id: "review_angular_pr",
        name: "Review Angular PR",
        description:
          "Performs a technical code review for an Angular PR using GitHub MCP and Angular-specific skills.",
      },
    },
    defaultReviewerClass: AngularReviewer,
    ...options,
  });
}
