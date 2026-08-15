import { describe, expect, it } from "vitest";
import { createHealthService } from "./health.service.js";
import { HealthResponseSchema } from "./response.model.js";

describe("health service", () => {
  it("returns a valid healthy status", () => {
    const response = createHealthService().getStatus();

    expect(response).toEqual({ status: "ok" });
    expect(HealthResponseSchema.safeParse(response).success).toBe(true);
  });
});
