import { describe, expect, it } from "vitest";
import { countComments } from "./reviews.comment-counts.js";
import { MOCK_SEED_REPORTS, MOCK_SEED_REVIEWS } from "./reviews.mock-seed.js";
import { createReviewsStore, type ReviewsStore } from "./reviews.store.js";

const BASE_PARAMS = { includeClosed: false, page: 1, perPage: 30 } as const;

function buildStore(deps?: Parameters<typeof createReviewsStore>[1]): ReviewsStore {
  return createReviewsStore(undefined, deps);
}

describe("mock seed invariants", () => {
  it.each(MOCK_SEED_REVIEWS.map((r) => r.reviewId))(
    "%s: declared commentCounts matches countComments(report.files)",
    (reviewId) => {
      const review = MOCK_SEED_REVIEWS.find((r) => r.reviewId === reviewId);
      const report = MOCK_SEED_REPORTS[reviewId];
      expect(review).toBeDefined();
      if (!report) {
        expect(review?.commentCounts).toEqual({ total: 0, open: 0, resolved: 0, falsePositive: 0 });
        return;
      }
      expect(review?.commentCounts).toEqual(countComments(report.files));
      expect(report.commentCounts).toEqual(countComments(report.files));
    },
  );
});

describe("listReviews", () => {
  it("returns all 6 seeded reviews by default", () => {
    const store = buildStore();
    const result = store.listReviews(BASE_PARAMS);

    expect(result.items).toHaveLength(6);
    expect(result.pageInfo).toEqual({ page: 1, perPage: 30, totalItems: 6, totalPages: 1 });
  });

  it("filters by org and repo", () => {
    const store = buildStore();
    const result = store.listReviews({ ...BASE_PARAMS, org: "acme-corp", repo: "design-system" });

    expect(result.items.map((r) => r.reviewId).sort()).toEqual(["pr-55", "pr-58"]);
  });

  it("filters by reviewStatus", () => {
    const store = buildStore();
    const result = store.listReviews({ ...BASE_PARAMS, reviewStatus: "waiting" });

    expect(result.items.map((r) => r.reviewId).sort()).toEqual(["pr-471", "pr-482"]);
  });

  it("matches q against title (partial, case-insensitive) and PR number", () => {
    const store = buildStore();

    expect(store.listReviews({ ...BASE_PARAMS, q: "Chip" }).items.map((r) => r.reviewId)).toEqual([
      "pr-55",
    ]);
    expect(store.listReviews({ ...BASE_PARAMS, q: "482" }).items.map((r) => r.reviewId)).toEqual([
      "pr-482",
    ]);
  });

  it("includes merged PRs (pr-55) by default since merged !== closed", () => {
    const store = buildStore();
    const result = store.listReviews(BASE_PARAMS);

    expect(result.items.map((r) => r.reviewId)).toContain("pr-55");
  });

  it("excludes closed reviews unless includeClosed is true", () => {
    const store = buildStore();
    const closeResult = store.closeReview("pr-55");
    expect(closeResult.ok).toBe(true);

    const withoutClosed = store.listReviews(BASE_PARAMS);
    expect(withoutClosed.items.map((r) => r.reviewId)).not.toContain("pr-55");

    const withClosed = store.listReviews({ ...BASE_PARAMS, includeClosed: true });
    expect(withClosed.items.map((r) => r.reviewId)).toContain("pr-55");
  });

  it("paginates using page/perPage", () => {
    const store = buildStore();
    const page1 = store.listReviews({ ...BASE_PARAMS, perPage: 2, page: 1 });
    const page2 = store.listReviews({ ...BASE_PARAMS, perPage: 2, page: 2 });

    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page1.pageInfo).toEqual({ page: 1, perPage: 2, totalItems: 6, totalPages: 3 });
    expect(page1.items.map((r) => r.reviewId)).not.toEqual(page2.items.map((r) => r.reviewId));
  });
});

describe("registerReview", () => {
  it("creates a new draft review for an unregistered PR", () => {
    const store = buildStore({ now: () => "2026-08-11T00:00:00Z" });
    const result = store.registerReview({
      organization: "acme-corp",
      repository: "web-frontend",
      pullRequest: 486,
    });

    expect(result.created).toBe(true);
    expect(result.data).toMatchObject({
      reviewId: "acme-corp:web-frontend:pr-486",
      status: "draft",
      reviewStatus: "not_started",
      latestAttemptId: null,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
    });

    const listed = store.listReviews(BASE_PARAMS);
    expect(listed.items.map((r) => r.reviewId)).toContain("acme-corp:web-frontend:pr-486");
  });

  it("returns the existing review without creating a duplicate", () => {
    const store = buildStore();
    const before = store.listReviews(BASE_PARAMS).items.length;

    const result = store.registerReview({
      organization: "acme-corp",
      repository: "web-frontend",
      pullRequest: 482,
    });

    expect(result.created).toBe(false);
    expect(result.data.reviewId).toBe("pr-482");
    expect(store.listReviews(BASE_PARAMS).items.length).toBe(before);
  });

  it("creates a distinct review when the same PR number exists under a different org/repo", () => {
    const store = buildStore({ now: () => "2026-08-11T00:00:00Z" });
    const before = store.listReviews(BASE_PARAMS).items.length;

    // pr-482 は既に organization=acme-corp/repository=web-frontend で登録済み。
    // 同じ pullRequest=482 を別テナントで登録しても、既存の pr-482 を誤って返さない。
    const result = store.registerReview({
      organization: "other-corp",
      repository: "other-repo",
      pullRequest: 482,
    });

    expect(result.created).toBe(true);
    expect(result.data.reviewId).not.toBe("pr-482");
    expect(result.data).toMatchObject({
      organization: "other-corp",
      repository: "other-repo",
      pullRequest: 482,
    });

    expect(store.listReviews(BASE_PARAMS).items.length).toBe(before + 1);
    const original = store.getReview("pr-482");
    expect(original).toMatchObject({ ok: true, data: { organization: "acme-corp" } });
  });
});

describe("getReview / getReport", () => {
  it("getReview returns not_found for an unknown reviewId", () => {
    const store = buildStore();
    expect(store.getReview("pr-9999")).toEqual({ ok: false, code: "not_found" });
  });

  it("getReport returns the report when the latest attempt succeeded", () => {
    const store = buildStore();
    const result = store.getReport("pr-482");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.attemptId).toBe("att-9f2c");
      expect(result.data.files).toHaveLength(3);
    }
  });

  it("getReport returns conflict while the latest attempt is still running", () => {
    const store = buildStore();
    expect(store.getReport("pr-490")).toEqual({ ok: false, code: "conflict" });
  });

  it("getReport returns conflict when the review has no attempt at all", () => {
    const store = buildStore();
    expect(store.getReport("pr-58")).toEqual({ ok: false, code: "conflict" });
  });

  it("getReport returns not_found for an unknown reviewId", () => {
    const store = buildStore();
    expect(store.getReport("pr-9999")).toEqual({ ok: false, code: "not_found" });
  });
});

describe("startAttempt", () => {
  it("creates a new attempt and moves the review into reviewing/analyzing", () => {
    const store = buildStore({
      now: () => "2026-08-11T00:00:00Z",
      nextAttemptId: () => "att-new1",
    });
    const result = store.startAttempt("pr-58");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      attemptId: "att-new1",
      reviewId: "pr-58",
      status: "queued",
    });

    const review = store.getReview("pr-58");
    expect(review.ok).toBe(true);
    if (review.ok) {
      expect(review.data.latestAttemptId).toBe("att-new1");
      expect(review.data.status).toBe("reviewing");
      expect(review.data.reviewStatus).toBe("analyzing");
    }
  });

  it("returns not_found for an unknown reviewId", () => {
    const store = buildStore();
    expect(store.startAttempt("pr-9999")).toEqual({ ok: false, code: "not_found" });
  });

  it("returns conflict for a closed review", () => {
    const store = buildStore();
    expect(store.closeReview("pr-55").ok).toBe(true);
    expect(store.startAttempt("pr-55")).toEqual({ ok: false, code: "conflict" });
  });
});

describe("getAttempt / cancelAttempt", () => {
  it("getAttempt returns not_found when attemptId does not belong to reviewId", () => {
    const store = buildStore();
    expect(store.getAttempt("pr-490", "att-9f2c")).toEqual({ ok: false, code: "not_found" });
  });

  it("cancelAttempt returns conflict for a terminal (succeeded) attempt", () => {
    const store = buildStore();
    expect(store.cancelAttempt("pr-482", "att-9f2c")).toEqual({ ok: false, code: "conflict" });
  });

  it("cancelAttempt cancels a running attempt without changing the review status", () => {
    const store = buildStore({ now: () => "2026-08-11T00:00:00Z" });
    const before = store.getReview("pr-490");
    expect(before.ok).toBe(true);

    const result = store.cancelAttempt("pr-490", "att-1b3d");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("canceled");
      expect(result.data.finishedAt).toBe("2026-08-11T00:00:00Z");
    }

    const after = store.getReview("pr-490");
    expect(after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.data.status).toBe(before.data.status);
      expect(after.data.reviewStatus).toBe(before.data.reviewStatus);
    }
  });
});

describe("applyDisposition", () => {
  it("open -> resolved is allowed and recomputes review aggregates", () => {
    const store = buildStore({ now: () => "2026-08-11T00:00:00Z" });
    const result = store.applyDisposition("pr-482", "att-9f2c", "c2", "resolved");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ commentId: "c2", disposition: "resolved" });
    }

    const review = store.getReview("pr-482");
    expect(review.ok).toBe(true);
    if (review.ok) {
      expect(review.data.commentCounts).toEqual({
        total: 4,
        open: 1,
        resolved: 2,
        falsePositive: 1,
      });
      expect(review.data.reviewStatus).toBe("waiting");
      expect(review.data.updatedAt).toBe("2026-08-11T00:00:00Z");
    }
  });

  it("resolving every open comment flips reviewStatus to completed", () => {
    const store = buildStore();
    expect(store.applyDisposition("pr-482", "att-9f2c", "c2", "resolved").ok).toBe(true);
    expect(store.applyDisposition("pr-482", "att-9f2c", "c3", "resolved").ok).toBe(true);

    const review = store.getReview("pr-482");
    expect(review.ok).toBe(true);
    if (review.ok) {
      expect(review.data.commentCounts.open).toBe(0);
      expect(review.data.reviewStatus).toBe("completed");
    }
  });

  it("open -> false_positive is allowed", () => {
    const store = buildStore();
    const result = store.applyDisposition("pr-482", "att-9f2c", "c3", "false_positive");
    expect(result.ok).toBe(true);
  });

  it("resolved -> false_positive is rejected as conflict", () => {
    const store = buildStore();
    expect(store.applyDisposition("pr-482", "att-9f2c", "c1", "false_positive")).toEqual({
      ok: false,
      code: "conflict",
    });
  });

  it("resolved -> open is allowed (reopen)", () => {
    const store = buildStore();
    expect(store.applyDisposition("pr-482", "att-9f2c", "c1", "open").ok).toBe(true);
  });

  it("returns not_found for an unknown commentId", () => {
    const store = buildStore();
    expect(store.applyDisposition("pr-482", "att-9f2c", "c-missing", "resolved")).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("returns not_found when the reviewId is unknown", () => {
    const store = buildStore();
    expect(store.applyDisposition("pr-9999", "att-9f2c", "c1", "resolved")).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});

describe("closeReview", () => {
  it("returns conflict while unresolved comments remain", () => {
    const store = buildStore();
    expect(store.closeReview("pr-482")).toEqual({ ok: false, code: "conflict" });
  });

  it("succeeds once every comment is resolved (disposition -> close chain)", () => {
    const store = buildStore();
    store.applyDisposition("pr-482", "att-9f2c", "c2", "resolved");
    store.applyDisposition("pr-482", "att-9f2c", "c3", "resolved");

    const result = store.closeReview("pr-482");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("closed");
    }
  });

  it("succeeds immediately for a review with no open comments (pr-55)", () => {
    const store = buildStore();
    expect(store.closeReview("pr-55").ok).toBe(true);
  });

  it("returns not_found for an unknown reviewId", () => {
    const store = buildStore();
    expect(store.closeReview("pr-9999")).toEqual({ ok: false, code: "not_found" });
  });
});

describe("store instances are isolated", () => {
  it("does not leak mutations between createReviewsStore() calls", () => {
    const storeA = buildStore();
    storeA.closeReview("pr-55");

    const storeB = buildStore();
    expect(storeB.getReview("pr-55")).toMatchObject({ ok: true, data: { status: "reviewed" } });
  });
});
