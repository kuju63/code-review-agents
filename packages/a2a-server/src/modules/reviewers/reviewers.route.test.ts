import { describe, expect, it } from "vitest";
import { createReviewersRoute } from "./reviewers.route.js";

describe("reviewer route placeholder", () => {
  it("returns an empty router", () => {
    expect(createReviewersRoute().routes).toHaveLength(0);
  });
});
