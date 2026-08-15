import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  LeadEngineerGetTaskRequestSchema,
  LeadEngineerSendTaskRequestSchema,
} from "./request.model.js";
import type { LeadEngineerSendTaskResponse } from "./response.model.js";

export function createLeadEngineerRoute(): Hono {
  const app = new Hono();
  app.get(".well-known/agent.json", async (req) => {
    // TODO(#253): Implement AgentCard generation, task submission, and task polling routes.
    throw Error("Not Found");
  });

  app.post("/tasks/send", zValidator("json", LeadEngineerSendTaskRequestSchema), async (c) => {
    c.json({} as LeadEngineerSendTaskResponse, 201);
    throw Error("Not Implemented");
  });

  app.get("/tasks/:taskId", zValidator("param", LeadEngineerGetTaskRequestSchema), async (c) => {
    throw Error("Not Implemented");
  });

  return app;
}
