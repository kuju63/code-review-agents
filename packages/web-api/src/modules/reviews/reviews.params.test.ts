import { describe, expect, it } from "vitest";
import {
  AttemptIdParamSchema,
  IdempotencyKeyHeaderSchema,
  ListReviewsQuerySchema,
  ReviewIdParamSchema,
} from "./reviews.params.js";

describe("ReviewIdParamSchema / AttemptIdParamSchema", () => {
  it("accept plain strings", () => {
    expect(ReviewIdParamSchema.parse("pr-482")).toBe("pr-482");
    expect(AttemptIdParamSchema.parse("att-9f2c")).toBe("att-9f2c");
  });
});

describe("IdempotencyKeyHeaderSchema", () => {
  it("makes the header optional", () => {
    expect(IdempotencyKeyHeaderSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an explicit key", () => {
    const parsed = IdempotencyKeyHeaderSchema.parse({ "Idempotency-Key": "3f8c1e2a" });
    expect(parsed["Idempotency-Key"]).toBe("3f8c1e2a");
  });
});

describe("ListReviewsQuerySchema", () => {
  it("applies reviews.yaml defaults when all params are omitted", () => {
    const parsed = ListReviewsQuerySchema.parse({});
    expect(parsed.includeClosed).toBe(false);
    expect(parsed.page).toBe(1);
    expect(parsed.perPage).toBe(30);
    expect(parsed.org).toBeUndefined();
    expect(parsed.repo).toBeUndefined();
    expect(parsed.reviewStatus).toBeUndefined();
    expect(parsed.q).toBeUndefined();
  });

  it("coerces includeClosed from the query string 'false' without the z.coerce.boolean() trap", () => {
    expect(ListReviewsQuerySchema.parse({ includeClosed: "false" }).includeClosed).toBe(false);
    expect(ListReviewsQuerySchema.parse({ includeClosed: "true" }).includeClosed).toBe(true);
  });

  it("rejects an includeClosed value outside true/false", () => {
    expect(ListReviewsQuerySchema.safeParse({ includeClosed: "yes" }).success).toBe(false);
  });

  it("coerces page/perPage from query strings", () => {
    const parsed = ListReviewsQuerySchema.parse({ page: "2", perPage: "50" });
    expect(parsed.page).toBe(2);
    expect(parsed.perPage).toBe(50);
  });

  it("rejects perPage below 1 or above 100", () => {
    expect(ListReviewsQuerySchema.safeParse({ perPage: "0" }).success).toBe(false);
    expect(ListReviewsQuerySchema.safeParse({ perPage: "101" }).success).toBe(false);
  });

  it("rejects a non-integer page", () => {
    expect(ListReviewsQuerySchema.safeParse({ page: "1.5" }).success).toBe(false);
  });

  it("accepts a reviewStatus value from the ReviewStatus enum", () => {
    expect(ListReviewsQuerySchema.parse({ reviewStatus: "waiting" }).reviewStatus).toBe("waiting");
    expect(ListReviewsQuerySchema.safeParse({ reviewStatus: "closed" }).success).toBe(false);
  });
});
