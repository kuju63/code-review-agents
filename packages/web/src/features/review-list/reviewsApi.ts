import {
  type Review,
  type ReviewListResponse,
  ReviewListResponseSchema,
  ReviewSchema,
} from "./reviews.schema";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type CloseReviewResult =
  | { ok: true; data: Review }
  | { ok: false; code: "not_found" | "conflict" };

/**
 * `q` on the server only matches title/PR number and `reviewStatus` accepts a
 * single value, so LST-07/08/09's AND-combined repo/status/branch filtering is
 * done client-side against the full (non-closed) set instead. `perPage=100` is
 * the schema max; revisit if `pageInfo.totalItems` regularly exceeds it.
 */
export async function fetchReviews(): Promise<ReviewListResponse> {
  const response = await fetch(`${API_BASE_URL}/reviews?includeClosed=false&perPage=100`);
  if (!response.ok) {
    throw new Error(`GET /reviews failed with status ${response.status}`);
  }
  const body = ReviewListResponseSchema.parse(await response.json());
  if (body.pageInfo.totalItems > body.items.length) {
    console.warn(
      `GET /reviews returned ${body.items.length} of ${body.pageInfo.totalItems} total reviews; ` +
        "increase perPage or add server-side branch search before this becomes lossy.",
    );
  }
  return body;
}

export async function closeReview(reviewId: string): Promise<CloseReviewResult> {
  const response = await fetch(`${API_BASE_URL}/reviews/${encodeURIComponent(reviewId)}/close`, {
    method: "POST",
  });
  if (response.status === 200) {
    return { ok: true, data: ReviewSchema.parse(await response.json()) };
  }
  if (response.status === 404) return { ok: false, code: "not_found" };
  if (response.status === 409) return { ok: false, code: "conflict" };
  throw new Error(
    `POST /reviews/${reviewId}/close failed with unexpected status ${response.status}`,
  );
}
