import { describe, expect, it } from "vitest";
import { createLeadEngineerRoute } from "./lead-engineer.route.js";

describe("Lead Engineer route skeleton", () => {
  it("registers the A2A endpoint trio", () => {
    const paths = [...new Set(createLeadEngineerRoute().routes.map((route) => route.path))];

    expect(paths).toEqual(["/.well-known/agent.json", "/tasks/send", "/tasks/:taskId"]);
  });
});
