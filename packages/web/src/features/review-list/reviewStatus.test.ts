import { describe, expect, it } from "vitest";
import {
  formatUpdatedAt,
  matchesSearch,
  resolveCommentSummary,
  resolvePrStateTag,
  resolveStatusTag,
  shouldShowCloseButton,
} from "./reviewStatus";
import type { Review } from "./reviews.schema";

function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "pr-1",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 1,
    title: "Fix login bug",
    branch: "fix/login",
    prState: "open",
    reviewStatus: "not_started",
    commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
    updatedAt: "2026-08-09T10:24:00+09:00",
    ...overrides,
  };
}

describe("resolveStatusTag", () => {
  it.each([
    ["not_started", "gray"],
    ["analyzing", "blue"],
    ["waiting", "purple"],
    ["completed", "green"],
    ["error", "red"],
  ] as const)("maps reviewStatus=%s to Carbon tag type=%s", (status, type) => {
    const tag = resolveStatusTag(status);
    expect(tag.type).toBe(type);
    expect(tag.labelKey).toBe(`reviewList.status.${status}`);
  });
});

describe("resolvePrStateTag (LST-15)", () => {
  it.each([
    ["open", "green"],
    ["closed", "gray"],
    ["merged", "purple"],
  ] as const)("maps prState=%s to Carbon tag type=%s", (prState, type) => {
    const tag = resolvePrStateTag(prState);
    expect(tag.type).toBe(type);
    expect(tag.labelKey).toBe(`reviewList.prState.${prState}`);
  });
});

describe("shouldShowCloseButton (LST-A08)", () => {
  it("shows for a completed review regardless of PR state", () => {
    expect(shouldShowCloseButton(review({ reviewStatus: "completed", prState: "open" }))).toBe(
      true,
    );
  });

  it("shows for a closed PR even if the review is still waiting", () => {
    expect(shouldShowCloseButton(review({ reviewStatus: "waiting", prState: "closed" }))).toBe(
      true,
    );
  });

  it("shows for a merged PR even if the review has not started", () => {
    expect(shouldShowCloseButton(review({ reviewStatus: "not_started", prState: "merged" }))).toBe(
      true,
    );
  });

  it("hides for an error row even when the PR is merged", () => {
    expect(shouldShowCloseButton(review({ reviewStatus: "error", prState: "merged" }))).toBe(false);
  });

  it("hides for an open PR that is still waiting", () => {
    expect(shouldShowCloseButton(review({ reviewStatus: "waiting", prState: "open" }))).toBe(false);
  });
});

describe("resolveCommentSummary (LST-16)", () => {
  it("reports an error summary when reviewStatus is error, even with stale counts", () => {
    expect(
      resolveCommentSummary(
        review({
          reviewStatus: "error",
          commentCounts: { total: 3, open: 3, resolved: 0, falsePositive: 0 },
        }),
      ),
    ).toEqual({ kind: "error" });
  });

  it("reports none when there are zero comments", () => {
    expect(
      resolveCommentSummary(
        review({ commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 } }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("reports the total comment count otherwise", () => {
    expect(
      resolveCommentSummary(
        review({
          reviewStatus: "waiting",
          commentCounts: { total: 5, open: 2, resolved: 3, falsePositive: 0 },
        }),
      ),
    ).toEqual({ kind: "count", count: 5 });
  });
});

describe("matchesSearch (LST-A04, branch included)", () => {
  it("matches on title case-insensitively", () => {
    expect(matchesSearch(review({ title: "Fix Login Bug" }), "login")).toBe(true);
  });

  it("matches on PR number", () => {
    expect(matchesSearch(review({ pullRequest: 482 }), "482")).toBe(true);
  });

  it("matches on branch name (not supported by the server q param)", () => {
    expect(matchesSearch(review({ branch: "feature/oauth-refresh" }), "oauth")).toBe(true);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(matchesSearch(review({ title: "Fix login bug" }), "  login  ")).toBe(true);
  });

  it("returns true for an empty/blank query", () => {
    expect(matchesSearch(review(), "   ")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesSearch(review({ title: "Fix login bug", branch: "fix/login" }), "billing")).toBe(
      false,
    );
  });

  it("treats a null title as non-matching text, not a crash", () => {
    expect(matchesSearch(review({ title: null, branch: "fix/login" }), "login")).toBe(true);
    expect(matchesSearch(review({ title: null, branch: "fix/login" }), "nonexistent")).toBe(false);
  });
});

describe("formatUpdatedAt (LST-17)", () => {
  it("formats an RFC3339 timestamp as JST YYYY-MM-DD HH:mm", () => {
    expect(formatUpdatedAt("2026-08-09T01:24:00Z")).toBe("2026-08-09 10:24");
  });

  it("normalizes a differently-offset timestamp to the same JST wall clock", () => {
    expect(formatUpdatedAt("2026-08-09T10:24:00+09:00")).toBe("2026-08-09 10:24");
  });

  it("renders midnight JST as 00:mm, not 24:mm", () => {
    expect(formatUpdatedAt("2026-08-08T15:00:00Z")).toBe("2026-08-09 00:00");
  });
});
