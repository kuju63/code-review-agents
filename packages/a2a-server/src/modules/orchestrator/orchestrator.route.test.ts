import { describe, expect, it } from "vitest";
import { createOrchestratorRoute } from "./orchestrator.route.js";

describe("Orchestrator route placeholder", () => {
  it("returns an empty router", () => {
    expect(createOrchestratorRoute().routes).toHaveLength(0);
  });
});
