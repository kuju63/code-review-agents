import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Review } from "./reviews.schema";
import { ALL_FILTER, useReviewListState } from "./useReviewListState";

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

const reviews: Review[] = [
  review({
    reviewId: "pr-1",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 1,
  }),
  review({
    reviewId: "pr-2",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 2,
    reviewStatus: "waiting",
    title: "Refactor auth",
    branch: "refactor/auth",
  }),
  review({
    reviewId: "pr-3",
    organization: "acme-corp",
    repository: "api-service",
    pullRequest: 3,
    reviewStatus: "completed",
    title: "Add rate limiting",
    branch: "feature/rate-limit",
  }),
];

beforeEach(() => {
  localStorage.clear();
});

describe("useReviewListState", () => {
  it("groups by repository in first-seen order with no filters applied", () => {
    const { result } = renderHook(() => useReviewListState(reviews));

    expect(result.current.repoOptions).toEqual(["acme-corp/web-frontend", "acme-corp/api-service"]);
    expect(result.current.groups.map((g) => g.repoKey)).toEqual([
      "acme-corp/web-frontend",
      "acme-corp/api-service",
    ]);
    expect(result.current.groups[0]?.reviews).toHaveLength(2);
  });

  it("filters by repo, status, and search with AND semantics (LST-A02/A03/A04)", () => {
    const { result } = renderHook(() => useReviewListState(reviews));

    act(() => result.current.setFilterRepo("acme-corp/web-frontend"));
    act(() => result.current.setFilterStatus("waiting"));
    act(() => result.current.setSearchQuery("auth"));

    expect(result.current.groups).toEqual([
      { repoKey: "acme-corp/web-frontend", reviews: [reviews[1]] },
    ]);
  });

  it("returns no groups when the AND-combined filters match nothing", () => {
    const { result } = renderHook(() => useReviewListState(reviews));

    act(() => result.current.setFilterStatus("error"));

    expect(result.current.groups).toEqual([]);
  });

  it("persists filter selections across remounts (LST-A05)", () => {
    const first = renderHook(() => useReviewListState(reviews));
    act(() => first.result.current.setFilterRepo("acme-corp/api-service"));
    act(() => first.result.current.setFilterStatus("completed"));
    act(() => first.result.current.setSearchQuery("rate"));
    first.unmount();

    const second = renderHook(() => useReviewListState(reviews));

    expect(second.result.current.filterRepo).toBe("acme-corp/api-service");
    expect(second.result.current.filterStatus).toBe("completed");
    expect(second.result.current.searchQuery).toBe("rate");
  });

  it("falls back a persisted repo filter to ALL when it no longer exists (LST-V02)", () => {
    localStorage.setItem("reviewList.filterRepo", "ghost-org/ghost-repo");

    const { result } = renderHook(() => useReviewListState(reviews));

    expect(result.current.filterRepo).toBe(ALL_FILTER);
  });

  it("falls back a corrupted persisted status filter to ALL (LST-V03)", () => {
    localStorage.setItem("reviewList.filterStatus", "not-a-real-status");

    const { result } = renderHook(() => useReviewListState(reviews));

    expect(result.current.filterStatus).toBe(ALL_FILTER);
  });

  it("toggles and persists per-repo collapsed state across remounts (LST-A06)", () => {
    const first = renderHook(() => useReviewListState(reviews));
    expect(first.result.current.isRepoCollapsed("acme-corp/web-frontend")).toBe(false);

    act(() => first.result.current.toggleRepoCollapsed("acme-corp/web-frontend"));
    expect(first.result.current.isRepoCollapsed("acme-corp/web-frontend")).toBe(true);
    first.unmount();

    const second = renderHook(() => useReviewListState(reviews));
    expect(second.result.current.isRepoCollapsed("acme-corp/web-frontend")).toBe(true);
    expect(second.result.current.isRepoCollapsed("acme-corp/api-service")).toBe(false);
  });
});
