import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useReviewRequestSelection } from "./useReviewRequestSelection";

describe("useReviewRequestSelection", () => {
  it("starts with nothing selected and step 0", () => {
    const { result } = renderHook(() => useReviewRequestSelection());
    expect(result.current.organization).toBeNull();
    expect(result.current.repository).toBeNull();
    expect(result.current.pullRequest).toBeNull();
    expect(result.current.step).toBe(0);
  });

  it("stays at step index 0 once an organization is selected (OP-01, org-only is still the design's first progress step)", () => {
    const { result } = renderHook(() => useReviewRequestSelection());
    act(() => result.current.selectOrganization("acme-corp"));
    expect(result.current.organization).toBe("acme-corp");
    expect(result.current.step).toBe(0);
  });

  it("moves to step 1 once a repository is selected (OP-02)", () => {
    const { result } = renderHook(() => useReviewRequestSelection());
    act(() => result.current.selectOrganization("acme-corp"));
    act(() => result.current.selectRepository("web-frontend"));
    expect(result.current.step).toBe(1);
  });

  it("moves to step 2 once a PR is selected (OP-03)", () => {
    const { result } = renderHook(() => useReviewRequestSelection());
    act(() => result.current.selectOrganization("acme-corp"));
    act(() => result.current.selectRepository("web-frontend"));
    act(() => result.current.selectPullRequest(482));
    expect(result.current.step).toBe(2);
  });

  it("clears repository and PR when the organization changes (OP-01)", () => {
    const { result } = renderHook(() => useReviewRequestSelection());
    act(() => result.current.selectOrganization("acme-corp"));
    act(() => result.current.selectRepository("web-frontend"));
    act(() => result.current.selectPullRequest(482));

    act(() => result.current.selectOrganization("other-org"));

    expect(result.current.repository).toBeNull();
    expect(result.current.pullRequest).toBeNull();
    expect(result.current.step).toBe(0);
  });

  it("clears only the PR when the repository changes (OP-02)", () => {
    const { result } = renderHook(() => useReviewRequestSelection());
    act(() => result.current.selectOrganization("acme-corp"));
    act(() => result.current.selectRepository("web-frontend"));
    act(() => result.current.selectPullRequest(482));

    act(() => result.current.selectRepository("other-repo"));

    expect(result.current.organization).toBe("acme-corp");
    expect(result.current.pullRequest).toBeNull();
    expect(result.current.step).toBe(1);
  });

  it("clears only the PR via clearPullRequest, keeping org/repo (VL-04)", () => {
    const { result } = renderHook(() => useReviewRequestSelection());
    act(() => result.current.selectOrganization("acme-corp"));
    act(() => result.current.selectRepository("web-frontend"));
    act(() => result.current.selectPullRequest(482));

    act(() => result.current.clearPullRequest());

    expect(result.current.organization).toBe("acme-corp");
    expect(result.current.repository).toBe("web-frontend");
    expect(result.current.pullRequest).toBeNull();
  });

  it("keeps the same idempotencyKey across re-renders for the same selection", () => {
    const { result, rerender } = renderHook(() => useReviewRequestSelection());
    act(() => result.current.selectOrganization("acme-corp"));
    act(() => result.current.selectRepository("web-frontend"));
    act(() => result.current.selectPullRequest(482));
    const firstKey = result.current.idempotencyKey;

    rerender();

    expect(result.current.idempotencyKey).toBe(firstKey);
  });

  it("regenerates the idempotencyKey when the PR selection changes", () => {
    const { result } = renderHook(() => useReviewRequestSelection());
    act(() => result.current.selectOrganization("acme-corp"));
    act(() => result.current.selectRepository("web-frontend"));
    act(() => result.current.selectPullRequest(482));
    const firstKey = result.current.idempotencyKey;

    act(() => result.current.selectPullRequest(999));

    expect(result.current.idempotencyKey).not.toBe(firstKey);
  });
});
