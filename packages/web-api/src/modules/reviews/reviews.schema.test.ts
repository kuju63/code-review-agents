import { describe, expect, it } from "vitest";
import { ApiVersionSchema, CommentCountsSchema } from "./reviews.schema.js";

describe("ApiVersionSchema", () => {
  it("accepts a semver-like string", () => {
    expect(ApiVersionSchema.parse("1.0.0")).toBe("1.0.0");
  });
});

describe("CommentCountsSchema", () => {
  it("requires all four count fields", () => {
    expect(
      CommentCountsSchema.safeParse({ total: 4, open: 2, resolved: 1, falsePositive: 1 }).success,
    ).toBe(true);

    for (const missing of ["total", "open", "resolved", "falsePositive"]) {
      const value: Record<string, number> = {
        total: 4,
        open: 2,
        resolved: 1,
        falsePositive: 1,
      };
      delete value[missing];
      expect(CommentCountsSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects negative counts", () => {
    expect(
      CommentCountsSchema.safeParse({ total: -1, open: 0, resolved: 0, falsePositive: 0 }).success,
    ).toBe(false);
  });
});
