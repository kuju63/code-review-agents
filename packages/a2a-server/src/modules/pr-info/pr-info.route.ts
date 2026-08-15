import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { PrInfoGetTaskRequestSchema, PrInfoSendTaskRequestSchema } from "./request.model.js";
import type { PrInfoSendTaskResponse } from "./response.model.js";

const createPrInfoRoute = (): Hono => {
  const app = new Hono();
  app.get(".well-known/agent.json", async (req) => {
    // TODO(#253): Implement AgentCard generation, task submission, and task polling routes.
    throw Error("Not Found");
  });

  app.post("/tasks/send", zValidator("json", PrInfoSendTaskRequestSchema), async (c) => {
    c.json({} as PrInfoSendTaskResponse, 201);
    throw Error();
  });

  app.get("/tasks/:taskId", zValidator("param", PrInfoGetTaskRequestSchema), async (c) => {
    throw Error();
  });

  return app;
};

export default createPrInfoRoute;
