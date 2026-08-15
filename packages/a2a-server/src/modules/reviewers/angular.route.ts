import {
  type AngularReviewerServiceOptions,
  createAngularReviewerService,
} from "./angular.service.js";
import { createReviewersRoute } from "./reviewers.route.js";

export function createAngularReviewerRoute(options: AngularReviewerServiceOptions = {}) {
  return createReviewersRoute({ service: createAngularReviewerService(options) });
}
