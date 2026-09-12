import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfigFromEnv } from "./config.js";
import { registerReviewsRoutes } from "./modules/reviews/reviews.route.js";
import { createReviewsStore } from "./modules/reviews/reviews.store.js";
import { registerSettingsRoutes } from "./modules/settings/settings.route.js";
import { createSettingsStore } from "./modules/settings/settings.store.js";

const config = loadConfigFromEnv();
const app = createApp();
const reviewsStore = createReviewsStore();
registerReviewsRoutes(app, reviewsStore);
const settingsStore = createSettingsStore();
registerSettingsRoutes(app, settingsStore);

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
