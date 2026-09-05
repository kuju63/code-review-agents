import { describe, expect, it } from "vitest";
import { REVIEW_LIST_EXAMPLE } from "./reviews.fixtures.js";
import { ReviewListResponseSchema } from "./reviews.schema.js";

describe("REVIEW_LIST_EXAMPLE", () => {
  it("parses as a ReviewListResponse and matches reviews.yaml's ReviewListExample", () => {
    const parsed = ReviewListResponseSchema.parse(REVIEW_LIST_EXAMPLE);
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0]?.reviewId).toBe("pr-482");
    expect(parsed.pageInfo).toEqual({ page: 1, perPage: 30, totalItems: 3, totalPages: 1 });
  });
});
