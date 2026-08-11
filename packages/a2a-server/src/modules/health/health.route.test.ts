import { describe, expect, it } from "vitest";
import { createHealthRoute } from "./health.route.js";

describe("health route placeholder", () => {
  it("returns an empty router", () => {
    expect(createHealthRoute().routes).toHaveLength(0);
  });
});
