import { describe, expect, it } from "vitest";
import { createLeadEngineerRoute } from "./lead-engineer.route.js";

describe("Lead Engineer route placeholder", () => {
  it("returns an empty router", () => {
    expect(createLeadEngineerRoute().routes).toHaveLength(0);
  });
});
