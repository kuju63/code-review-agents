import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfigFromEnv } from "./config.js";
import { registerReviewsRoutes } from "./modules/reviews/reviews.route.js";

const config = loadConfigFromEnv();
const app = createApp();
registerReviewsRoutes(app);

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
