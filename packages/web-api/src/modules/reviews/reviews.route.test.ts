import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { REVIEW_LIST_EXAMPLE } from "./reviews.fixtures.js";
import { registerReviewsRoutes } from "./reviews.route.js";

function buildTestApp() {
  const app = createApp();
  registerReviewsRoutes(app);
  return app;
}

describe("GET /reviews", () => {
  it("returns the ReviewListExample fixture", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVIEW_LIST_EXAMPLE);
  });

  it("returns 422 when perPage is out of range", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews?perPage=0");

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation_error");
  });
});
