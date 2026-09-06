import { describe, expect, it } from "vitest";
import { ReviewSchema } from "./reviews.schema";

function review(updatedAt: string) {
  return {
    reviewId: "pr-1",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 1,
    title: "Fix login bug",
    branch: "fix/login",
    prState: "open" as const,
    reviewStatus: "not_started" as const,
    commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
    updatedAt,
  };
}

describe("ReviewSchema updatedAt", () => {
  it("accepts a UTC (Z) updatedAt", () => {
    expect(() => ReviewSchema.parse(review("2026-08-09T10:24:00Z"))).not.toThrow();
  });

  it("accepts a numeric-offset updatedAt", () => {
    expect(() => ReviewSchema.parse(review("2026-08-09T10:24:00+09:00"))).not.toThrow();
  });

  it("accepts a fractional-second updatedAt", () => {
    expect(() => ReviewSchema.parse(review("2026-08-09T10:24:00.123Z"))).not.toThrow();
  });

  it("rejects a non-RFC3339 updatedAt (contract drift)", () => {
    expect(() => ReviewSchema.parse(review("2026-08-09 10:24"))).toThrow();
  });
});
