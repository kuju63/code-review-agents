import { createReactReviewerService, type ReactReviewerServiceOptions } from "./react.service.js";
import { createReviewersRoute } from "./reviewers.route.js";

export function createReactReviewerRoute(options: ReactReviewerServiceOptions = {}) {
  return createReviewersRoute({ service: createReactReviewerService(options) });
}
