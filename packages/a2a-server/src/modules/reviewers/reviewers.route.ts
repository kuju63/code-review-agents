import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ReviewerGetTaskRequestSchema, ReviewerSendTaskRequestSchema } from "./request.model.js";
import type { ReviewerSendTaskResponse } from "./response.model.js";

export function createReviewersRoute(): Hono {
  const app = new Hono();
  app.get(".well-known/agent.json", async (req) => {
    // TODO(#253): Implement AgentCard generation, task submission, and task polling routes.
    throw Error("Not Found");
  });

  app.post("/tasks/send", zValidator("json", ReviewerSendTaskRequestSchema), async (c) => {
    c.json({} as ReviewerSendTaskResponse, 201);
    throw Error("Not Implemented");
  });

  app.get("/tasks/:taskId", zValidator("param", ReviewerGetTaskRequestSchema), async (c) => {
    throw Error("Not Implemented");
  });

  return app;
}
