import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { createGithubAuthMiddleware, type GithubAuthEnv } from "../a2a/auth.middleware.js";
import { A2ASendTaskRequestSchema } from "../a2a/request.model.js";
import { createLeadEngineerService, type LeadEngineerService } from "./lead-engineer.service.js";
import { LeadEngineerGetTaskRequestSchema } from "./request.model.js";

type CreateLeadEngineerRouteOptions = {
  service?: LeadEngineerService;
  authMiddleware?: MiddlewareHandler<GithubAuthEnv>;
};

export function createLeadEngineerRoute({
  service = createLeadEngineerService(),
  authMiddleware = createGithubAuthMiddleware(),
}: CreateLeadEngineerRouteOptions = {}): Hono<GithubAuthEnv> {
  const app = new Hono<GithubAuthEnv>();

  app.get("/.well-known/agent.json", (c) => c.json(service.getAgentCard(), 200));

  app.post(
    "/tasks/send",
    authMiddleware,
    zValidator("json", A2ASendTaskRequestSchema),
    async (c) => {
      const response = await service.sendTask(c.req.valid("json"), c.get("githubToken"));
      return c.json(response, 202);
    },
  );

  app.get(
    "/tasks/:taskId",
    zValidator("param", LeadEngineerGetTaskRequestSchema.shape.params),
    async (c) => {
      const task = await service.getTask(c.req.valid("param").taskId);
      if (!task) {
        return c.json({ detail: "Task not found" }, 404);
      }
      return c.json(task, 200);
    },
  );

  return app;
}
