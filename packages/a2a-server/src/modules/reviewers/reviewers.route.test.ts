import { describe, expect, it } from "vitest";
import { createReviewersRoute } from "./reviewers.route.js";

describe("reviewer route skeleton", () => {
  it("registers the A2A endpoint trio", () => {
    const paths = [...new Set(createReviewersRoute().routes.map((route) => route.path))];

    expect(paths).toEqual(["/.well-known/agent.json", "/tasks/send", "/tasks/:taskId"]);
  });
});
