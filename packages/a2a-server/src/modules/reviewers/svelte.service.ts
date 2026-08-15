import { SvelteReviewer } from "@code-review-agent/agent-core/agents/reviewers/svelte.js";
import {
  createReviewerService,
  type ReviewerService,
  type ReviewerServiceOptions,
} from "./reviewer-runtime.js";

export type SvelteReviewerServiceOptions = ReviewerServiceOptions<typeof SvelteReviewer>;

export function createSvelteReviewerService(
  options: SvelteReviewerServiceOptions = {},
): ReviewerService {
  return createReviewerService({
    metadata: {
      name: "Svelte Reviewer",
      description:
        "Reviews Svelte pull requests for reactivity, event handling, snippets, styling, context, and migration correctness.",
      path: "svelte-reviewer",
      skill: {
        id: "review_svelte_pr",
        name: "Review Svelte PR",
        description:
          "Performs a technical code review for a Svelte PR using GitHub MCP and Svelte-specific skills.",
      },
    },
    defaultReviewerClass: SvelteReviewer,
    ...options,
  });
}
