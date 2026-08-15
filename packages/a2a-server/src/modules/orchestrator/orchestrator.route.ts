import { Hono } from "hono";
import { logger } from "hono/logger";

/**
 * Create routes for orchestrator
 */
export const createOrchestratorRoute = (): Hono => {
  const app = new Hono();

  // AgentCard
  app.get("/.well-known/agent.json", logger(), (c) => {
    // TODO(#253): Implement AgentCard generation, task submission, and task polling routes.
    throw Error("Not Implemented");
  });

  // Register Task
  app.post("/tasks/send", logger(), (c) => {
    //     TODO: Implement task registration
    throw Error("Not Implemented");
  });

  // Get task status
  app.get("/tasks/:taskId", logger(), (c) => {
    //     TODO: Implement to get task status
    throw Error("Not Implemented");
  });

  return app;
};
