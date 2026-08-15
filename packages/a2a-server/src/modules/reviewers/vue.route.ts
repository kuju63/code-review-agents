import { createReviewersRoute } from "./reviewers.route.js";
import { createVueReviewerService, type VueReviewerServiceOptions } from "./vue.service.js";

export function createVueReviewerRoute(options: VueReviewerServiceOptions = {}) {
  return createReviewersRoute({ service: createVueReviewerService(options) });
}
