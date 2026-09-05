import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import {
  REVIEW_ATTEMPT_CANCELED_EXAMPLE,
  REVIEW_ATTEMPT_QUEUED_EXAMPLE,
  REVIEW_CLOSED_EXAMPLE,
  REVIEW_COMMENT_EXAMPLE,
  REVIEW_DRAFT_EXAMPLE,
  REVIEW_LIST_EXAMPLE,
  REVIEW_REPORT_EXAMPLE,
  REVIEW_REVIEWED_EXAMPLE,
} from "./reviews.fixtures.js";
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

describe("POST /reviews", () => {
  it("returns 201 with a Location header and the draft fixture", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization: "acme-corp",
        repository: "web-frontend",
        pullRequest: 486,
      }),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("Location")).toBe(`/reviews/${REVIEW_DRAFT_EXAMPLE.reviewId}`);
    expect(await res.json()).toEqual(REVIEW_DRAFT_EXAMPLE);
  });

  it("returns 422 when the request body is invalid", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization: "acme-corp" }),
    });

    expect(res.status).toBe(422);
  });
});

describe("GET /reviews/{reviewId}", () => {
  it("returns the reviewed fixture", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVIEW_REVIEWED_EXAMPLE);
  });
});

describe("GET /reviews/{reviewId}/report", () => {
  it("returns the report fixture", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/report");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVIEW_REPORT_EXAMPLE);
  });
});

describe("POST /reviews/{reviewId}/attempts", () => {
  it("returns 202 with the queued attempt fixture, even without a body", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(REVIEW_ATTEMPT_QUEUED_EXAMPLE);
  });

  it("returns 202 when a modelId body is provided", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "ornith:latest" }),
    });

    expect(res.status).toBe(202);
  });
});

describe("GET /reviews/{reviewId}/attempts/{attemptId}", () => {
  it("returns the queued attempt fixture", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-9f2c");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVIEW_ATTEMPT_QUEUED_EXAMPLE);
  });
});

describe("POST /reviews/{reviewId}/attempts/{attemptId}/cancel", () => {
  it("returns the canceled attempt fixture", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-9f2c/cancel", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVIEW_ATTEMPT_CANCELED_EXAMPLE);
  });
});

describe("POST /reviews/{reviewId}/attempts/{attemptId}/disposition", () => {
  it("returns the ReviewComment fixture without an apiVersion field", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-9f2c/disposition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: "c2", disposition: "resolved" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(REVIEW_COMMENT_EXAMPLE);
    expect(body.apiVersion).toBeUndefined();
  });

  it("returns 422 for an invalid disposition value", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-9f2c/disposition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: "c2", disposition: "archived" }),
    });

    expect(res.status).toBe(422);
  });
});

describe("POST /reviews/{reviewId}/close", () => {
  it("returns the closed review fixture", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/close", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVIEW_CLOSED_EXAMPLE);
  });
});
