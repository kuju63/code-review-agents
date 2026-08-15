import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { createGithubAuthMiddleware, type GithubAuthEnv } from "../a2a/auth.middleware.js";
import { A2ASendTaskRequestSchema } from "../a2a/request.model.js";
import { createPrInfoService, extractData, type PrInfoService } from "./pr-info.service.js";
import { CollectPrInfoInputSchema, PrInfoGetTaskRequestSchema } from "./request.model.js";

type CreatePrInfoRouteOptions = {
  service?: PrInfoService;
  authMiddleware?: MiddlewareHandler<GithubAuthEnv>;
};

export function createPrInfoRoute({
  service = createPrInfoService(),
  authMiddleware = createGithubAuthMiddleware(),
}: CreatePrInfoRouteOptions = {}): Hono<GithubAuthEnv> {
  const app = new Hono<GithubAuthEnv>();

  app.get("/.well-known/agent.json", (c) => c.json(service.getAgentCard(), 200));

  app.post(
    "/tasks/send",
    authMiddleware,
    zValidator("json", A2ASendTaskRequestSchema),
    async (c) => {
      const request = c.req.valid("json");
      const input = CollectPrInfoInputSchema.safeParse(extractData(request.message));
      if (!input.success) {
        return c.json({ detail: "Invalid PR Info input" }, 400);
      }
      const response = await service.sendTask(
        request,
        c.get("githubToken"),
        c.get("githubPrincipalId"),
      );
      return c.json(response, 202);
    },
  );

  app.get(
    "/tasks/:taskId",
    authMiddleware,
    zValidator("param", PrInfoGetTaskRequestSchema.shape.params),
    async (c) => {
      const task = await service.getTask(c.req.valid("param").taskId, c.get("githubPrincipalId"));
      if (!task) {
        return c.json({ detail: "Task not found" }, 404);
      }
      return c.json(task, 200);
    },
  );

  return app;
}

export default createPrInfoRoute;
