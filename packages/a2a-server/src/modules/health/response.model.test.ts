import { describe, expect, it } from "vitest";
import { HealthHttpResponseSchema, HealthResponseSchema } from "./response.model.js";

describe("health response model", () => {
  it("accepts the healthy response", () => {
    expect(HealthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
    expect(HealthHttpResponseSchema.parse({ status: 200, body: { status: "ok" } })).toEqual({
      status: 200,
      body: { status: "ok" },
    });
  });
});
