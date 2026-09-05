import { describe, expect, it } from "vitest";
import { ApiVersionSchema, CommentCountsSchema, ErrorResponseSchema } from "./reviews.schema.js";

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

describe("ErrorResponseSchema", () => {
  it("defaults detail to null when omitted", () => {
    const parsed = ErrorResponseSchema.parse({
      apiVersion: "1.0.0",
      code: "validation_error",
      message: "invalid request",
    });
    expect(parsed.detail).toBeNull();
  });

  it("accepts an explicit detail string", () => {
    const parsed = ErrorResponseSchema.parse({
      apiVersion: "1.0.0",
      code: "not_found",
      message: "not found",
      detail: "reviewId pr-999 does not exist",
    });
    expect(parsed.detail).toBe("reviewId pr-999 does not exist");
  });

  it("rejects a code outside the ErrorCode taxonomy", () => {
    expect(
      ErrorResponseSchema.safeParse({
        apiVersion: "1.0.0",
        code: "totally_made_up",
        message: "x",
      }).success,
    ).toBe(false);
  });

  it("requires apiVersion, code, and message", () => {
    expect(ErrorResponseSchema.safeParse({ code: "not_found", message: "x" }).success).toBe(false);
    expect(ErrorResponseSchema.safeParse({ apiVersion: "1.0.0", message: "x" }).success).toBe(
      false,
    );
    expect(ErrorResponseSchema.safeParse({ apiVersion: "1.0.0", code: "not_found" }).success).toBe(
      false,
    );
  });
});
