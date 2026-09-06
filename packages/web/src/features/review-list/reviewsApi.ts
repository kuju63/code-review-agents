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

async function fetchReviewsPage(page: number): Promise<ReviewListResponse> {
  const response = await fetch(
    `${API_BASE_URL}/reviews?includeClosed=false&perPage=100&page=${page}`,
  );
  if (!response.ok) {
    throw new Error(`GET /reviews failed with status ${response.status}`);
  }
  return ReviewListResponseSchema.parse(await response.json());
}

/**
 * `q` on the server only matches title/PR number and `reviewStatus` accepts a
 * single value, so LST-07/08/09's AND-combined repo/status/branch filtering is
 * done client-side against the full (non-closed) set instead. `perPage=100` is
 * the schema max, so pages beyond the first are fetched sequentially (one
 * request per page, not in parallel, to keep server load bounded) and their
 * items concatenated — this makes total request count scale linearly with
 * review volume; revisit if that becomes a problem.
 */
export async function fetchReviews(): Promise<ReviewListResponse> {
  const first = await fetchReviewsPage(1);
  const items = [...first.items];
  // Bound the loop by page 1's totalPages so a mid-fetch change in the
  // server's total can't turn this into an unbounded chase.
  for (let page = 2; page <= first.pageInfo.totalPages; page += 1) {
    const next = await fetchReviewsPage(page);
    items.push(...next.items);
  }
  if (first.pageInfo.totalItems > items.length) {
    console.warn(
      `GET /reviews returned ${items.length} of ${first.pageInfo.totalItems} total reviews across ` +
        `${first.pageInfo.totalPages} page(s); the server's total may have changed mid-fetch.`,
    );
  }
  return { ...first, items };
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
