import { randomUUID } from "node:crypto";
import type { z } from "@hono/zod-openapi";
import { countComments } from "./reviews.comment-counts.js";
import type { CommentDispositionSchema, ReviewStatusSchema } from "./reviews.enums.js";
import { MOCK_SEED, type ReviewsSeed } from "./reviews.mock-seed.js";
import {
  type RegisterReviewRequestSchema,
  ReviewAttemptSchema,
  type ReviewCommentSchema,
  type ReviewReportSchema,
  ReviewSchema,
} from "./reviews.schema.js";

type Review = z.infer<typeof ReviewSchema>;
type ReviewAttempt = z.infer<typeof ReviewAttemptSchema>;
type ReviewReport = z.infer<typeof ReviewReportSchema>;
type ReviewComment = z.infer<typeof ReviewCommentSchema>;
type RegisterReviewRequest = z.infer<typeof RegisterReviewRequestSchema>;
type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
type CommentDisposition = z.infer<typeof CommentDispositionSchema>;

export interface ListReviewsParams {
  org?: string;
  repo?: string;
  reviewStatus?: ReviewStatus;
  q?: string;
  includeClosed: boolean;
  page: number;
  perPage: number;
}

export interface PageInfoResult {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export interface ListReviewsResult {
  items: Review[];
  pageInfo: PageInfoResult;
}

export type StoreResult<T> = { ok: true; data: T } | { ok: false; code: "not_found" | "conflict" };

export interface RegisterReviewResult {
  created: boolean;
  data: Review;
}

export interface ReviewsStore {
  listReviews(params: ListReviewsParams): ListReviewsResult;
  registerReview(request: RegisterReviewRequest): RegisterReviewResult;
  getReview(reviewId: string): StoreResult<Review>;
  getReport(reviewId: string): StoreResult<ReviewReport>;
  startAttempt(reviewId: string): StoreResult<ReviewAttempt>;
  getAttempt(reviewId: string, attemptId: string): StoreResult<ReviewAttempt>;
  cancelAttempt(reviewId: string, attemptId: string): StoreResult<ReviewAttempt>;
  applyDisposition(
    reviewId: string,
    attemptId: string,
    commentId: string,
    disposition: CommentDisposition,
  ): StoreResult<ReviewComment>;
  closeReview(reviewId: string): StoreResult<Review>;
}

export interface ReviewsStoreDeps {
  now?: () => string;
  nextAttemptId?: () => string;
}

/** disposition の許可される遷移。open⇄{resolved,false_positive}のみ、それ以外はconflict (SCR-03 RES-V05)。 */
const ALLOWED_DISPOSITION_TRANSITIONS: Record<CommentDisposition, readonly CommentDisposition[]> = {
  open: ["resolved", "false_positive"],
  resolved: ["open"],
  false_positive: ["open"],
};

const TERMINAL_ATTEMPT_STATUSES = new Set(["succeeded", "failed", "canceled"]);

interface StoreState {
  reviews: Map<string, Review>;
  attempts: Map<string, ReviewAttempt>;
  reports: Map<string, ReviewReport>;
}

function cloneState(seed: ReviewsSeed): StoreState {
  const cloned = structuredClone({
    reviews: seed.reviews,
    attempts: seed.attempts,
    reports: seed.reports,
  });
  return {
    reviews: new Map(cloned.reviews.map((review) => [review.reviewId, review])),
    attempts: new Map(cloned.attempts.map((attempt) => [attempt.attemptId, attempt])),
    reports: new Map(Object.entries(cloned.reports)),
  };
}

/**
 * プロセス内メモリのダミーストア (Issue #245)。`docs/mocks/assets/mock-data.js` 由来の
 * `seed` を `structuredClone` して保持し、DB永続化・Idempotency-Key payload比較・
 * AI Agent呼び出し・Valkey流量制御は行わない (再起動でリセットされる)。
 * Honoの`Context`に依存しない純粋な入出力を持つ (packages/web-api/CLAUDE.md)。
 */
export function createReviewsStore(
  seed: ReviewsSeed = MOCK_SEED,
  deps: ReviewsStoreDeps = {},
): ReviewsStore {
  const now = deps.now ?? (() => new Date().toISOString());
  const nextAttemptId = deps.nextAttemptId ?? (() => `att-${randomUUID().slice(0, 8)}`);
  const state = cloneState(seed);

  function getAttemptInternal(reviewId: string, attemptId: string): StoreResult<ReviewAttempt> {
    const attempt = state.attempts.get(attemptId);
    if (!attempt || attempt.reviewId !== reviewId) {
      return { ok: false, code: "not_found" };
    }
    return { ok: true, data: attempt };
  }

  /**
   * Comment→Report.commentCounts→Review.commentCounts→Review.reviewStatus
   * (waiting⇄completed) の順に再計算する。`status !== "reviewed"` の間は
   * reviewStatus を触らない (analyzing/error/not_startedはdisposition対象外)。
   */
  function recomputeReviewAggregates(reviewId: string): void {
    const report = state.reports.get(reviewId);
    const review = state.reviews.get(reviewId);
    if (!report || !review) return;
    const counts = countComments(report.files);
    report.commentCounts = counts;
    review.commentCounts = counts;
    if (review.status === "reviewed") {
      review.reviewStatus = counts.open > 0 ? "waiting" : "completed";
    }
    review.updatedAt = now();
  }

  return {
    listReviews({ org, repo, reviewStatus, q, includeClosed, page, perPage }) {
      const query = q?.toLowerCase();
      const filtered = [...state.reviews.values()].filter((review) => {
        if (org && review.organization !== org) return false;
        if (repo && review.repository !== repo) return false;
        if (reviewStatus && review.reviewStatus !== reviewStatus) return false;
        // includeClosed は Review.status (domain) を見る。prState (open/closed/merged) とは無関係
        // — merged な pr-55 も status !== "closed" である限り既定の一覧に表示される。
        if (!includeClosed && review.status === "closed") return false;
        if (query) {
          const titleMatch = review.title?.toLowerCase().includes(query) ?? false;
          const numberMatch = String(review.pullRequest).includes(query);
          if (!titleMatch && !numberMatch) return false;
        }
        return true;
      });
      const totalItems = filtered.length;
      const totalPages = Math.ceil(totalItems / perPage);
      const start = (page - 1) * perPage;
      const items = filtered.slice(start, start + perPage);
      return { items, pageInfo: { page, perPage, totalItems, totalPages } };
    },

    registerReview(request) {
      // reviewId ("pr-123" のような文字列) だけで既存判定すると、異なる
      // organization/repository で同じ pullRequest 番号を登録した際に別テナントの
      // Review を誤って返してしまう。pullRequest は repository 内でのみ一意なため、
      // 既存判定は organization/repository/pullRequest の組で行う。
      const existing = [...state.reviews.values()].find(
        (review) =>
          review.organization === request.organization &&
          review.repository === request.repository &&
          review.pullRequest === request.pullRequest,
      );
      if (existing) {
        return { created: false, data: existing };
      }
      const reviewId = `${request.organization}:${request.repository}:pr-${request.pullRequest}`;
      const timestamp = now();
      const review = ReviewSchema.parse({
        apiVersion: "1.0.0",
        reviewId,
        organization: request.organization,
        repository: request.repository,
        pullRequest: request.pullRequest,
        title: null,
        branch: null,
        baseBranch: null,
        author: null,
        commitSha: request.commitSha ?? null,
        prState: "open",
        status: "draft",
        reviewStatus: "not_started",
        latestAttemptId: null,
        commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      state.reviews.set(reviewId, review);
      return { created: true, data: review };
    },

    getReview(reviewId) {
      const review = state.reviews.get(reviewId);
      return review ? { ok: true, data: review } : { ok: false, code: "not_found" };
    },

    getReport(reviewId) {
      const review = state.reviews.get(reviewId);
      if (!review) return { ok: false, code: "not_found" };
      const latestAttempt = review.latestAttemptId
        ? state.attempts.get(review.latestAttemptId)
        : undefined;
      if (latestAttempt?.status !== "succeeded") {
        return { ok: false, code: "conflict" };
      }
      const report = state.reports.get(reviewId);
      // seed/registerReview の不変条件上、succeeded な attempt を持つ review は
      // 必ず report を持つ。Map.get の型 (T | undefined) を満たすためのガード。
      if (!report) return { ok: false, code: "not_found" };
      return { ok: true, data: report };
    },

    startAttempt(reviewId) {
      const review = state.reviews.get(reviewId);
      if (!review) return { ok: false, code: "not_found" };
      if (review.status === "closed") return { ok: false, code: "conflict" };
      const timestamp = now();
      const attempt = ReviewAttemptSchema.parse({
        apiVersion: "1.0.0",
        attemptId: nextAttemptId(),
        reviewId,
        status: "queued",
        errorCode: null,
        errorMessage: null,
        createdAt: timestamp,
        startedAt: null,
        finishedAt: null,
      });
      state.attempts.set(attempt.attemptId, attempt);
      review.latestAttemptId = attempt.attemptId;
      review.status = "reviewing";
      review.reviewStatus = "analyzing";
      review.updatedAt = timestamp;
      return { ok: true, data: attempt };
    },

    getAttempt: getAttemptInternal,

    cancelAttempt(reviewId, attemptId) {
      const result = getAttemptInternal(reviewId, attemptId);
      if (!result.ok) return result;
      if (TERMINAL_ATTEMPT_STATUSES.has(result.data.status)) {
        return { ok: false, code: "conflict" };
      }
      // reviews.yaml のcancel仕様は「現在のattempt状態を返す」のみで、Review.status/
      // reviewStatus の更新には触れていないため、意図的にReview側は変更しない。
      result.data.status = "canceled";
      result.data.finishedAt = now();
      return { ok: true, data: result.data };
    },

    applyDisposition(reviewId, attemptId, commentId, disposition) {
      // attemptId は「reviewIdに属するattemptとして存在するか」だけを見る。この
      // dummy storeではreport はreviewId単位の単一データであり、attempt単位で
      // 分岐しないため、最新attemptに限定せず許容する (permissive)。
      const attemptResult = getAttemptInternal(reviewId, attemptId);
      if (!attemptResult.ok) return attemptResult;
      const report = state.reports.get(reviewId);
      if (!report) return { ok: false, code: "not_found" };
      const comment = report.files
        .flatMap((file) => file.comments ?? [])
        .find((c) => c.commentId === commentId);
      if (!comment) return { ok: false, code: "not_found" };
      if (!ALLOWED_DISPOSITION_TRANSITIONS[comment.disposition].includes(disposition)) {
        return { ok: false, code: "conflict" };
      }
      comment.disposition = disposition;
      recomputeReviewAggregates(reviewId);
      return { ok: true, data: comment };
    },

    closeReview(reviewId) {
      const review = state.reviews.get(reviewId);
      if (!review) return { ok: false, code: "not_found" };
      if (review.commentCounts.open > 0) return { ok: false, code: "conflict" };
      review.status = "closed";
      review.updatedAt = now();
      return { ok: true, data: review };
    },
  };
}
