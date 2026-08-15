import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadServerSettingsFromEnv } from "./config.js";
import { createLeadEngineerRoute } from "./modules/lead-engineer/lead-engineer.route.js";
import { createLeadEngineerService } from "./modules/lead-engineer/lead-engineer.service.js";
import { createOrchestratorRoute } from "./modules/orchestrator/orchestrator.route.js";
import { createOrchestratorService } from "./modules/orchestrator/orchestrator.service.js";
import createPrInfoRoute from "./modules/pr-info/pr-info.route.js";
import { createPrInfoService } from "./modules/pr-info/pr-info.service.js";
import {
  createAngularReviewerRoute,
  createReactReviewerRoute,
  createSecurityReviewerRoute,
  createSvelteReviewerRoute,
  createVueReviewerRoute,
} from "./modules/reviewers/index.js";

const settings = loadServerSettingsFromEnv();

const app = new Hono();
app.route("/pr-info-collector", createPrInfoRoute({ service: createPrInfoService({ settings }) }));
app.route("/react-reviewer", createReactReviewerRoute({ settings }));
app.route("/vue-reviewer", createVueReviewerRoute({ settings }));
app.route("/angular-reviewer", createAngularReviewerRoute({ settings }));
app.route("/svelte-reviewer", createSvelteReviewerRoute({ settings }));
app.route("/security-reviewer", createSecurityReviewerRoute({ settings }));
app.route(
  "/lead-engineer",
  createLeadEngineerRoute({ service: createLeadEngineerService({ settings }) }),
);
app.route(
  "/orchestrator",
  createOrchestratorRoute({ service: createOrchestratorService({ settings }) }),
);

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
