import { createReviewersRoute } from "./reviewers.route.js";
import {
  createSvelteReviewerService,
  type SvelteReviewerServiceOptions,
} from "./svelte.service.js";

export function createSvelteReviewerRoute(options: SvelteReviewerServiceOptions = {}) {
  return createReviewersRoute({ service: createSvelteReviewerService(options) });
}
