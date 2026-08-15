import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLeadEngineerRoute } from "./modules/lead-engineer/index.js";
import createPrInfoRoute from "./modules/pr-info/pr-info.route.js";
import {
  createAngularReviewerRoute,
  createReactReviewerRoute,
  createSecurityReviewerRoute,
  createSvelteReviewerRoute,
  createVueReviewerRoute,
} from "./modules/reviewers/index.js";

const app = new Hono();
app.route("/pr-info-collector", createPrInfoRoute());
app.route("/react-reviewer", createReactReviewerRoute());
app.route("/vue-reviewer", createVueReviewerRoute());
app.route("/angular-reviewer", createAngularReviewerRoute());
app.route("/svelte-reviewer", createSvelteReviewerRoute());
app.route("/security-reviewer", createSecurityReviewerRoute());
app.route("/lead-engineer", createLeadEngineerRoute());

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
