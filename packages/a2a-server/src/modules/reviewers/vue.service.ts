import { VueReviewer } from "@code-review-agent/agent-core/agents/reviewers/vue.js";
import {
  createReviewerService,
  type ReviewerService,
  type ReviewerServiceOptions,
} from "./reviewer-runtime.js";

export type VueReviewerServiceOptions = ReviewerServiceOptions<typeof VueReviewer>;

export function createVueReviewerService(options: VueReviewerServiceOptions = {}): ReviewerService {
  return createReviewerService({
    metadata: {
      name: "Vue Reviewer",
      description:
        "Reviews Vue pull requests for component design, reactivity, computed/watch usage, and template correctness.",
      path: "vue-reviewer",
      skill: {
        id: "review_vue_pr",
        name: "Review Vue PR",
        description: "Performs a technical code review for a Vue PR using GitHub MCP.",
      },
    },
    defaultReviewerClass: VueReviewer,
    ...options,
  });
}
