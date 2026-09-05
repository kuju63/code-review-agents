import { describe, expect, it } from "vitest";
import {
  ApiVersionSchema,
  CommentCountsSchema,
  DiffLineSchema,
  ErrorResponseSchema,
  ReviewCommentSchema,
  ReviewFileChangeSchema,
} from "./reviews.schema.js";

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

describe("DiffLineSchema", () => {
  it("defaults oldLine/newLine to null when omitted", () => {
    const parsed = DiffLineSchema.parse({ type: "add", text: "+x" });
    expect(parsed.oldLine).toBeNull();
    expect(parsed.newLine).toBeNull();
  });

  it("rejects a type outside ctx/add/del", () => {
    expect(DiffLineSchema.safeParse({ type: "modify", text: "x" }).success).toBe(false);
  });
});

describe("ReviewCommentSchema", () => {
  it("does not have an apiVersion field, unlike the other 2xx envelopes", () => {
    expect(Object.keys(ReviewCommentSchema.shape)).not.toContain("apiVersion");
  });

  it("defaults filePath/line to null when omitted", () => {
    const parsed = ReviewCommentSchema.parse({
      commentId: "c2",
      category: "Best Practice",
      severity: "medium",
      body: "text",
      disposition: "open",
    });
    expect(parsed.filePath).toBeNull();
    expect(parsed.line).toBeNull();
  });

  it("requires commentId, category, severity, body, and disposition", () => {
    expect(
      ReviewCommentSchema.safeParse({
        category: "Style",
        severity: "low",
        body: "x",
        disposition: "open",
      }).success,
    ).toBe(false);
  });
});

describe("ReviewFileChangeSchema", () => {
  it("accepts empty lines/comments arrays", () => {
    const parsed = ReviewFileChangeSchema.parse({
      filePath: "src/components/Button.tsx",
      status: "M",
      additions: 1,
      deletions: 0,
      lines: [],
      comments: [],
    });
    expect(parsed.lines).toEqual([]);
    expect(parsed.comments).toEqual([]);
  });

  it("requires filePath, status, additions, and deletions", () => {
    expect(
      ReviewFileChangeSchema.safeParse({ status: "A", additions: 1, deletions: 0 }).success,
    ).toBe(false);
  });
});
