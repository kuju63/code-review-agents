import { describe, expect, it } from "vitest";
import {
  ApiVersionSchema,
  CommentCountsSchema,
  DiffLineSchema,
  DispositionRequestSchema,
  ErrorResponseSchema,
  RegisterReviewRequestSchema,
  ReviewAttemptSchema,
  ReviewCommentSchema,
  ReviewFileChangeSchema,
  ReviewSchema,
  StartAttemptRequestSchema,
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

const REVIEW_REQUIRED_FIELDS = {
  apiVersion: "1.0.0",
  reviewId: "pr-486",
  organization: "acme-corp",
  repository: "web-frontend",
  pullRequest: 486,
  prState: "open",
  status: "draft",
  reviewStatus: "not_started",
  commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
  createdAt: "2026-09-05T00:00:00Z",
  updatedAt: "2026-09-05T00:00:00Z",
};

describe("ReviewSchema", () => {
  it("defaults every nullable field to null when omitted", () => {
    const parsed = ReviewSchema.parse(REVIEW_REQUIRED_FIELDS);
    expect(parsed.title).toBeNull();
    expect(parsed.branch).toBeNull();
    expect(parsed.baseBranch).toBeNull();
    expect(parsed.author).toBeNull();
    expect(parsed.commitSha).toBeNull();
    expect(parsed.latestAttemptId).toBeNull();
    expect(parsed.errorMessage).toBeNull();
  });

  it("requires all 11 required fields", () => {
    for (const key of Object.keys(REVIEW_REQUIRED_FIELDS)) {
      const value: Record<string, unknown> = { ...REVIEW_REQUIRED_FIELDS };
      delete value[key];
      expect(ReviewSchema.safeParse(value).success, `missing ${key} should fail`).toBe(false);
    }
  });

  it("keeps status (ReviewDomainStatus) and reviewStatus (ReviewStatus) as separate required fields", () => {
    const parsed = ReviewSchema.parse(REVIEW_REQUIRED_FIELDS);
    expect(parsed.status).toBe("draft");
    expect(parsed.reviewStatus).toBe("not_started");
  });
});

const REVIEW_ATTEMPT_REQUIRED_FIELDS = {
  apiVersion: "1.0.0",
  attemptId: "att-9f2c",
  reviewId: "pr-482",
  status: "queued",
  createdAt: "2026-09-05T00:00:00Z",
};

describe("ReviewAttemptSchema", () => {
  it("defaults nullable fields to null when omitted, including the oneOf-encoded errorCode", () => {
    const parsed = ReviewAttemptSchema.parse(REVIEW_ATTEMPT_REQUIRED_FIELDS);
    expect(parsed.errorCode).toBeNull();
    expect(parsed.errorMessage).toBeNull();
    expect(parsed.startedAt).toBeNull();
    expect(parsed.finishedAt).toBeNull();
  });

  it("accepts a valid ErrorCode value for errorCode", () => {
    const parsed = ReviewAttemptSchema.parse({
      ...REVIEW_ATTEMPT_REQUIRED_FIELDS,
      status: "failed",
      errorCode: "timeout",
    });
    expect(parsed.errorCode).toBe("timeout");
  });

  it("rejects an errorCode outside the ErrorCode taxonomy", () => {
    expect(
      ReviewAttemptSchema.safeParse({
        ...REVIEW_ATTEMPT_REQUIRED_FIELDS,
        errorCode: "not_a_real_code",
      }).success,
    ).toBe(false);
  });

  it("requires apiVersion, attemptId, reviewId, status, and createdAt", () => {
    for (const key of Object.keys(REVIEW_ATTEMPT_REQUIRED_FIELDS)) {
      const value: Record<string, unknown> = { ...REVIEW_ATTEMPT_REQUIRED_FIELDS };
      delete value[key];
      expect(ReviewAttemptSchema.safeParse(value).success, `missing ${key} should fail`).toBe(
        false,
      );
    }
  });
});

describe("RegisterReviewRequestSchema", () => {
  it("requires organization, repository, and pullRequest", () => {
    expect(
      RegisterReviewRequestSchema.safeParse({ repository: "web-frontend", pullRequest: 482 })
        .success,
    ).toBe(false);
    expect(
      RegisterReviewRequestSchema.safeParse({ organization: "acme-corp", pullRequest: 482 })
        .success,
    ).toBe(false);
    expect(
      RegisterReviewRequestSchema.safeParse({
        organization: "acme-corp",
        repository: "web-frontend",
      }).success,
    ).toBe(false);
  });

  it("accepts a valid 40-hex-digit commitSha", () => {
    expect(
      RegisterReviewRequestSchema.safeParse({
        organization: "acme-corp",
        repository: "web-frontend",
        pullRequest: 482,
        commitSha: "a3f9c2e8d4b1f67a2c9e5d0b8f3a71c6e9d4b2a1",
      }).success,
    ).toBe(true);
  });

  it("rejects a commitSha that is not exactly 40 hex digits", () => {
    expect(
      RegisterReviewRequestSchema.safeParse({
        organization: "acme-corp",
        repository: "web-frontend",
        pullRequest: 482,
        commitSha: "not-a-sha",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-positive pullRequest", () => {
    expect(
      RegisterReviewRequestSchema.safeParse({
        organization: "acme-corp",
        repository: "web-frontend",
        pullRequest: 0,
      }).success,
    ).toBe(false);
  });
});

describe("StartAttemptRequestSchema", () => {
  it("accepts an empty body since all fields are optional", () => {
    expect(StartAttemptRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an explicit modelId", () => {
    expect(StartAttemptRequestSchema.parse({ modelId: "ornith:latest" }).modelId).toBe(
      "ornith:latest",
    );
  });
});

describe("DispositionRequestSchema", () => {
  it("requires commentId and disposition", () => {
    expect(DispositionRequestSchema.safeParse({ commentId: "c2" }).success).toBe(false);
    expect(DispositionRequestSchema.safeParse({ disposition: "resolved" }).success).toBe(false);
  });

  it("accepts a valid disposition value", () => {
    const parsed = DispositionRequestSchema.parse({ commentId: "c2", disposition: "resolved" });
    expect(parsed.disposition).toBe("resolved");
  });

  it("rejects a disposition outside the CommentDisposition enum", () => {
    expect(
      DispositionRequestSchema.safeParse({ commentId: "c2", disposition: "archived" }).success,
    ).toBe(false);
  });
});
