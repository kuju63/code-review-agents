import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { REVIEW_REVIEWED_EXAMPLE } from "./reviews.fixtures.js";
import { registerReviewsRoutes } from "./reviews.route.js";

function buildTestApp() {
  const app = createApp();
  registerReviewsRoutes(app);
  return app;
}

describe("GET /reviews", () => {
  it("returns all 6 seeded reviews", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(6);
    expect(body.pageInfo.totalItems).toBe(6);
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
  it("returns 201 with a Location header for a new PR", async () => {
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
    expect(res.headers.get("Location")).toBe("/reviews/pr-486");
    const body = await res.json();
    expect(body.reviewId).toBe("pr-486");
    expect(body.status).toBe("draft");
  });

  it("returns 200 with the existing review when the PR is already registered", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization: "acme-corp",
        repository: "web-frontend",
        pullRequest: 482,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
    const body = await res.json();
    expect(body.reviewId).toBe("pr-482");
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
  it("returns the reviewed fixture as a non-mutating regression anchor", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REVIEW_REVIEWED_EXAMPLE);
  });

  it("returns 404 for an unknown reviewId", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-9999");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });
});

describe("GET /reviews/{reviewId}/report", () => {
  it("returns the report once the latest attempt has succeeded", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/report");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviewId).toBe("pr-482");
    expect(body.attemptId).toBe("att-9f2c");
  });

  it("returns 409 while the latest attempt has not succeeded yet", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-58/report");

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("conflict");
  });

  it("returns 404 for an unknown reviewId", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-9999/report");

    expect(res.status).toBe(404);
  });
});

describe("POST /reviews/{reviewId}/attempts", () => {
  it("returns 202 with a freshly generated attemptId, not the seeded one", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts", { method: "POST" });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.attemptId).not.toBe("att-9f2c");
    expect(body.status).toBe("queued");
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

  it("returns 404 for an unknown reviewId", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-9999/attempts", { method: "POST" });

    expect(res.status).toBe(404);
  });
});

describe("GET /reviews/{reviewId}/attempts/{attemptId}", () => {
  it("returns the seeded attempt with its succeeded status", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-9f2c");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("succeeded");
  });

  it("returns 404 for an unknown attemptId", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-missing");

    expect(res.status).toBe(404);
  });
});

describe("POST /reviews/{reviewId}/attempts/{attemptId}/cancel", () => {
  it("returns 409 because the seeded attempt already succeeded (terminal state)", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-9f2c/cancel", { method: "POST" });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("conflict");
  });

  it("returns 404 for an unknown reviewId", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-9999/attempts/att-9f2c/cancel", {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /reviews/{reviewId}/attempts/{attemptId}/disposition", () => {
  it("marks c2 (open) as resolved, not the fixture's fixed c1 value", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-9f2c/disposition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: "c2", disposition: "resolved" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commentId).toBe("c2");
    expect(body.disposition).toBe("resolved");
    expect(body.apiVersion).toBeUndefined();
  });

  it("returns 409 for a disallowed transition (resolved -> false_positive)", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/attempts/att-9f2c/disposition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: "c1", disposition: "false_positive" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("conflict");
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

  it("returns 404 for an unknown reviewId", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-9999/attempts/att-9f2c/disposition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: "c2", disposition: "resolved" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /reviews/{reviewId}/close", () => {
  it("returns 409 because pr-482 still has 2 open comments", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-482/close", { method: "POST" });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("conflict");
  });

  it("returns 404 for an unknown reviewId", async () => {
    const app = buildTestApp();
    const res = await app.request("/reviews/pr-9999/close", { method: "POST" });

    expect(res.status).toBe(404);
  });

  it("succeeds once every comment has been resolved (disposition -> close chain)", async () => {
    const app = buildTestApp();

    await app.request("/reviews/pr-482/attempts/att-9f2c/disposition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: "c2", disposition: "resolved" }),
    });
    await app.request("/reviews/pr-482/attempts/att-9f2c/disposition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: "c3", disposition: "resolved" }),
    });

    const reviewRes = await app.request("/reviews/pr-482");
    const review = await reviewRes.json();
    expect(review.commentCounts.open).toBe(0);
    expect(review.reviewStatus).toBe("completed");

    const closeRes = await app.request("/reviews/pr-482/close", { method: "POST" });
    expect(closeRes.status).toBe(200);
    const closed = await closeRes.json();
    expect(closed.status).toBe("closed");
  });
});
