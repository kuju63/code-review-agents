import { describe, expect, it } from "vitest";
import { createOrchestratorRoute } from "./orchestrator.route.js";

describe("Orchestrator route skeleton", () => {
  it("registers the A2A endpoint trio", () => {
    const paths = [...new Set(createOrchestratorRoute().routes.map((route) => route.path))];

    expect(paths).toEqual(["/.well-known/agent.json", "/tasks/send", "/tasks/:taskId"]);
  });
});
