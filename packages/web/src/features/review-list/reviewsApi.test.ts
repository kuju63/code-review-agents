import { describe, expect, it, vi } from "vitest";
import { setApiFetchHandler } from "../../test/setup";
import type { Review, ReviewListResponse } from "./reviews.schema";
import { closeReview, fetchReviews } from "./reviewsApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "pr-1",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 1,
    title: "Fix login bug",
    branch: "fix/login",
    prState: "open",
    reviewStatus: "not_started",
    commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
    updatedAt: "2026-08-09T10:24:00+09:00",
    ...overrides,
  };
}

function listResponse(
  items: Review[],
  totalItems = items.length,
  page = 1,
  totalPages = 1,
): ReviewListResponse {
  return {
    apiVersion: "1.0.0",
    items,
    pageInfo: { page, perPage: 100, totalItems, totalPages },
  };
}

function pageParam(url: string): string | null {
  return new URL(url, "http://localhost").searchParams.get("page");
}

describe("fetchReviews", () => {
  it("requests includeClosed=false, perPage=100, and page=1, then returns parsed items", async () => {
    const handler = vi.fn().mockResolvedValue(jsonResponse(listResponse([review()])));
    setApiFetchHandler(handler);

    const result = await fetchReviews();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.reviewId).toBe("pr-1");
    const requestedUrl = String(handler.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("includeClosed=false");
    expect(requestedUrl).toContain("perPage=100");
    expect(requestedUrl).toContain("page=1");
  });

  it("fetches and concatenates all pages when totalPages > 1", async () => {
    const handler = vi.fn().mockImplementation(async (input: string | URL) => {
      const page = pageParam(String(input));
      if (page === "2") {
        return jsonResponse(listResponse([review({ reviewId: "pr-2" })], 2, 2, 2));
      }
      return jsonResponse(listResponse([review({ reviewId: "pr-1" })], 2, 1, 2));
    });
    setApiFetchHandler(handler);

    const result = await fetchReviews();

    expect(result.items.map((item) => item.reviewId)).toEqual(["pr-1", "pr-2"]);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(pageParam(String(handler.mock.calls[1]?.[0]))).toBe("2");
  });

  it("does not issue extra requests when totalPages is 1", async () => {
    const handler = vi.fn().mockResolvedValue(jsonResponse(listResponse([review()])));
    setApiFetchHandler(handler);

    await fetchReviews();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fixes the page bound from page 1 and ignores a later page's different totalPages", async () => {
    const handler = vi.fn().mockImplementation(async (input: string | URL) => {
      const page = pageParam(String(input));
      if (page === "2") {
        // Simulates the server's total growing mid-fetch; must not chase page 3.
        return jsonResponse(listResponse([review({ reviewId: "pr-2" })], 3, 2, 3));
      }
      return jsonResponse(listResponse([review({ reviewId: "pr-1" })], 2, 1, 2));
    });
    setApiFetchHandler(handler);

    await fetchReviews();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("throws on a response that fails schema validation (contract drift)", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse({ items: "not-an-array" })));

    await expect(fetchReviews()).rejects.toBeTruthy();
  });

  it("throws when the server responds with a non-2xx status", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    await expect(fetchReviews()).rejects.toBeTruthy();
  });

  it("warns but does not fail when totalItems exceeds items already fetched", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse(listResponse([review()], 200))));

    await fetchReviews();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("closeReview", () => {
  it("returns the updated review on 200", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse(review({ prState: "closed" }))));

    const result = await closeReview("pr-1");

    expect(result).toEqual({ ok: true, data: review({ prState: "closed" }) });
  });

  it("returns a not_found result on 404 without throwing", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse({}, 404)));

    expect(await closeReview("pr-missing")).toEqual({ ok: false, code: "not_found" });
  });

  it("returns a conflict result on 409 (unresolved comments remain)", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse({}, 409)));

    expect(await closeReview("pr-1")).toEqual({ ok: false, code: "conflict" });
  });

  it("throws on an unexpected status code", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    await expect(closeReview("pr-1")).rejects.toBeTruthy();
  });
});
