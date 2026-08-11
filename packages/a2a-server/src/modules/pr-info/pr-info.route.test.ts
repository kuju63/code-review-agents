import { describe, expect, it } from "vitest";
import { createPrInfoRoute } from "./pr-info.route.js";

describe("PR Info route placeholder", () => {
  it("returns an empty router", () => {
    expect(createPrInfoRoute().routes).toHaveLength(0);
  });
});
