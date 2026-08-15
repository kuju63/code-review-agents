import { describe, expect, it, vi } from "vitest";
import { createHealthRoute } from "./health.route.js";
import type { HealthService } from "./health.service.js";

describe("health route", () => {
  it("returns 200 with the exact status body from the service", async () => {
    const app = createHealthRoute();

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("delegates the response body to the injected service", async () => {
    const getStatus = vi.fn(() => ({ status: "ok" }) as const);
    const service: HealthService = { getStatus };
    const app = createHealthRoute({ service });

    const response = await app.request("/");

    expect(getStatus).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
