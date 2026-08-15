import { Hono } from "hono";
import { createHealthService, type HealthService } from "./health.service.js";

type CreateHealthRouteOptions = {
  service?: HealthService;
};

export function createHealthRoute({
  service = createHealthService(),
}: CreateHealthRouteOptions = {}): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json(service.getStatus(), 200));

  return app;
}

export default createHealthRoute;
