import type { PrState, Review, ReviewStatus } from "./reviews.schema";

export type StatusTagType = "gray" | "blue" | "purple" | "green" | "red";

export interface StatusTag {
  type: StatusTagType;
  labelKey: `reviewList.status.${ReviewStatus}`;
}

export type CommentSummary =
  | { kind: "error" }
  | { kind: "none" }
  | { kind: "count"; count: number };

/** Colors per review-list.html §4 — these are Carbon's white-theme Tag hexes, not arbitrary choices. */
const STATUS_TAG_TYPE: Record<ReviewStatus, StatusTagType> = {
  not_started: "gray",
  analyzing: "blue",
  waiting: "purple",
  completed: "green",
  error: "red",
};

export function resolveStatusTag(reviewStatus: ReviewStatus): StatusTag {
  return { type: STATUS_TAG_TYPE[reviewStatus], labelKey: `reviewList.status.${reviewStatus}` };
}

export interface PrStateTag {
  type: StatusTagType;
  labelKey: `reviewList.prState.${PrState}`;
}

/** LST-15: GitHub PR state, shown independently of the review status. */
const PR_STATE_TAG_TYPE: Record<PrState, StatusTagType> = {
  open: "green",
  closed: "gray",
  merged: "purple",
};

export function resolvePrStateTag(prState: PrState): PrStateTag {
  return { type: PR_STATE_TAG_TYPE[prState], labelKey: `reviewList.prState.${prState}` };
}

/**
 * LST-A08: completed reviews, or PRs already closed/merged, are done being
 * tracked here — except error rows, which need the retry path instead.
 */
export function shouldShowCloseButton(review: Pick<Review, "reviewStatus" | "prState">): boolean {
  if (review.reviewStatus === "error") return false;
  return (
    review.reviewStatus === "completed" ||
    review.prState === "closed" ||
    review.prState === "merged"
  );
}

export function resolveCommentSummary(
  review: Pick<Review, "reviewStatus" | "commentCounts">,
): CommentSummary {
  if (review.reviewStatus === "error") return { kind: "error" };
  if (review.commentCounts.total === 0) return { kind: "none" };
  return { kind: "count", count: review.commentCounts.total };
}

/** LST-12: `#<番号> <タイトル>` (falls back to just the number when title is null). */
export function formatPrTitle(review: Pick<Review, "pullRequest" | "title">): string {
  return review.title ? `#${review.pullRequest} ${review.title}` : `#${review.pullRequest}`;
}

/** LST-A04/LST-V04: PR number, title, and branch (server `q` covers only the first two). */
export function matchesSearch(
  review: Pick<Review, "title" | "pullRequest" | "branch">,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystacks = [review.title, String(review.pullRequest), review.branch];
  return haystacks.some((value) => value?.toLowerCase().includes(normalized) ?? false);
}

/** LST-17: fixed JST `YYYY-MM-DD HH:mm` regardless of viewer locale. */
export function formatUpdatedAt(updatedAt: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(updatedAt));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
