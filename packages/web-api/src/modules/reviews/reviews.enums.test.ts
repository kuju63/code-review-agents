import { describe, expect, it } from "vitest";
import {
  AttemptStatusSchema,
  CommentDispositionSchema,
  ErrorCodeSchema,
  FileChangeStatusSchema,
  FindingCategorySchema,
  FindingImpactSchema,
  FindingSeveritySchema,
  PrStateSchema,
  ReviewDomainStatusSchema,
  ReviewStatusSchema,
} from "./reviews.enums.js";

describe("PrStateSchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(PrStateSchema.options).toEqual(["open", "closed", "merged"]);
  });
});

describe("ReviewStatusSchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(ReviewStatusSchema.options).toEqual([
      "not_started",
      "analyzing",
      "waiting",
      "completed",
      "error",
    ]);
  });
});

describe("ReviewDomainStatusSchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(ReviewDomainStatusSchema.options).toEqual([
      "draft",
      "reviewing",
      "reviewed",
      "failed",
      "closed",
      "canceled",
    ]);
  });
});

describe("ReviewStatus vs ReviewDomainStatus", () => {
  it("are distinct enums despite the similar names", () => {
    const overlap = ReviewStatusSchema.options.filter((value) =>
      (ReviewDomainStatusSchema.options as readonly string[]).includes(value),
    );
    expect(overlap).toEqual([]);
  });
});

describe("AttemptStatusSchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(AttemptStatusSchema.options).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
      "canceled",
    ]);
  });
});

describe("ErrorCodeSchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(ErrorCodeSchema.options).toEqual([
      "validation_error",
      "not_found",
      "conflict",
      "queue_overload",
      "upstream_github_failure",
      "upstream_model_failure",
      "timeout",
      "canceled",
    ]);
  });
});

describe("CommentDispositionSchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(CommentDispositionSchema.options).toEqual(["open", "resolved", "false_positive"]);
  });
});

describe("FindingCategorySchema", () => {
  it("accepts exactly the reviews.yaml enum values, including the space in 'Best Practice'", () => {
    expect(FindingCategorySchema.options).toEqual([
      "Security",
      "Performance",
      "Best Practice",
      "Style",
    ]);
  });
});

describe("FindingSeveritySchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(FindingSeveritySchema.options).toEqual(["critical", "high", "medium", "low"]);
  });
});

describe("FindingImpactSchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(FindingImpactSchema.options).toEqual([
      "security",
      "correctness",
      "performance",
      "maintainability",
    ]);
  });
});

describe("FileChangeStatusSchema", () => {
  it("accepts exactly the reviews.yaml enum values", () => {
    expect(FileChangeStatusSchema.options).toEqual(["M", "A", "D"]);
  });
});
