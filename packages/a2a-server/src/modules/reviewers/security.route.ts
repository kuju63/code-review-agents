import { createReviewersRoute } from "./reviewers.route.js";
import {
  createSecurityReviewerService,
  type SecurityReviewerServiceOptions,
} from "./security.service.js";

export function createSecurityReviewerRoute(options: SecurityReviewerServiceOptions = {}) {
  return createReviewersRoute({ service: createSecurityReviewerService(options) });
}
