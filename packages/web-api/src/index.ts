import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { loadConfigFromEnv } from "./config.js";

const config = loadConfigFromEnv();

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
