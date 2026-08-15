import { serve } from "@hono/node-server";
import { Hono } from "hono";
import createPrInfoRoute from "./modules/pr-info/pr-info.route.js";

const app = new Hono();
app.route("/pr-info-collector", createPrInfoRoute());

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
