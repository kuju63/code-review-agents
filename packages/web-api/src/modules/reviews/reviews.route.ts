import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import {
  REVIEW_ATTEMPT_CANCELED_EXAMPLE,
  REVIEW_ATTEMPT_QUEUED_EXAMPLE,
  REVIEW_CLOSED_EXAMPLE,
  REVIEW_COMMENT_EXAMPLE,
  REVIEW_DRAFT_EXAMPLE,
  REVIEW_LIST_EXAMPLE,
  REVIEW_REPORT_EXAMPLE,
  REVIEW_REVIEWED_EXAMPLE,
} from "./reviews.fixtures.js";
import {
  AttemptIdParamSchema,
  IdempotencyKeyHeaderSchema,
  ListReviewsQuerySchema,
  ReviewIdParamSchema,
} from "./reviews.params.js";
import {
  DispositionRequestSchema,
  ErrorResponseSchema,
  RegisterReviewRequestSchema,
  ReviewAttemptSchema,
  ReviewCommentSchema,
  ReviewListResponseSchema,
  ReviewReportSchema,
  ReviewSchema,
  StartAttemptRequestSchema,
} from "./reviews.schema.js";

const validationErrorResponse = {
  description: "入力検証失敗 (validation_error)。",
  content: { "application/json": { schema: ErrorResponseSchema } },
} as const;

const notFoundResponse = {
  description: "対象が存在しないか参照できない (not_found)。",
  content: { "application/json": { schema: ErrorResponseSchema } },
} as const;

const conflictResponse = {
  description: "Idempotency-Key の payload 不一致、または状態競合 (conflict)。",
  content: { "application/json": { schema: ErrorResponseSchema } },
} as const;

const reviewIdParams = z.object({ reviewId: ReviewIdParamSchema });
const reviewAndAttemptIdParams = z.object({
  reviewId: ReviewIdParamSchema,
  attemptId: AttemptIdParamSchema,
});

const listReviewsRoute = createRoute({
  method: "get",
  tags: ["reviews-query"],
  operationId: "listReviews",
  path: "/reviews",
  request: {
    query: ListReviewsQuerySchema,
  },
  responses: {
    200: {
      description: "一覧取得成功。",
      content: { "application/json": { schema: ReviewListResponseSchema } },
    },
    422: validationErrorResponse,
  },
});

const registerReviewRoute = createRoute({
  method: "post",
  tags: ["reviews-command"],
  operationId: "registerReview",
  path: "/reviews",
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: {
      required: true,
      content: { "application/json": { schema: RegisterReviewRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "登録成功 (新規Review作成)。",
      headers: { Location: { schema: { type: "string" }, required: true } },
      content: { "application/json": { schema: ReviewSchema } },
    },
    200: {
      description: "Idempotency-Key replay。既存Reviewを現在の状態で返す。",
      content: { "application/json": { schema: ReviewSchema } },
    },
    409: conflictResponse,
    422: validationErrorResponse,
    502: {
      description: "GitHub上流呼び出し失敗 (upstream_github_failure)。",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const getReviewRoute = createRoute({
  method: "get",
  tags: ["reviews-query"],
  operationId: "getReview",
  path: "/reviews/{reviewId}",
  request: {
    params: reviewIdParams,
  },
  responses: {
    200: {
      description: "取得成功。",
      content: { "application/json": { schema: ReviewSchema } },
    },
    404: notFoundResponse,
  },
});

const getReviewReportRoute = createRoute({
  method: "get",
  tags: ["reviews-query"],
  operationId: "getReviewReport",
  path: "/reviews/{reviewId}/report",
  request: {
    params: reviewIdParams,
  },
  responses: {
    200: {
      description: "取得成功。",
      content: { "application/json": { schema: ReviewReportSchema } },
    },
    404: notFoundResponse,
    409: {
      description: "レビュー結果が未確定 (最新Attemptが succeeded でない)。",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const startReviewAttemptRoute = createRoute({
  method: "post",
  tags: ["reviews-command"],
  operationId: "startReviewAttempt",
  path: "/reviews/{reviewId}/attempts",
  request: {
    params: reviewIdParams,
    headers: IdempotencyKeyHeaderSchema,
    body: {
      required: false,
      content: { "application/json": { schema: StartAttemptRequestSchema } },
    },
  },
  responses: {
    202: {
      description: "受付成功 (attempt作成)。",
      content: { "application/json": { schema: ReviewAttemptSchema } },
    },
    200: {
      description: "Idempotency-Key replay。既存attemptを現在の状態で返す。",
      content: { "application/json": { schema: ReviewAttemptSchema } },
    },
    404: notFoundResponse,
    409: conflictResponse,
    503: {
      description: "Gateway受付超過 (queue_overload)。",
      headers: { "Retry-After": { schema: { type: "integer" } } },
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const getReviewAttemptRoute = createRoute({
  method: "get",
  tags: ["reviews-query"],
  operationId: "getReviewAttempt",
  path: "/reviews/{reviewId}/attempts/{attemptId}",
  request: {
    params: reviewAndAttemptIdParams,
  },
  responses: {
    200: {
      description: "取得成功。",
      content: { "application/json": { schema: ReviewAttemptSchema } },
    },
    404: notFoundResponse,
  },
});

const cancelReviewAttemptRoute = createRoute({
  method: "post",
  tags: ["reviews-command"],
  operationId: "cancelReviewAttempt",
  path: "/reviews/{reviewId}/attempts/{attemptId}/cancel",
  request: {
    params: reviewAndAttemptIdParams,
  },
  responses: {
    200: {
      description: "キャンセル受付。現在の attempt 状態を返す。",
      content: { "application/json": { schema: ReviewAttemptSchema } },
    },
    404: notFoundResponse,
    409: {
      description: "既に終端状態 (succeeded/failed/canceled) でキャンセル不可。",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const applyCommentDispositionRoute = createRoute({
  method: "post",
  tags: ["reviews-command"],
  operationId: "applyCommentDisposition",
  path: "/reviews/{reviewId}/attempts/{attemptId}/disposition",
  request: {
    params: reviewAndAttemptIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: DispositionRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "更新成功。更新後のコメントを返す。",
      content: { "application/json": { schema: ReviewCommentSchema } },
    },
    404: notFoundResponse,
    409: {
      description: "不正な状態遷移 (RES-V05)。",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    422: validationErrorResponse,
  },
});

const closeReviewRoute = createRoute({
  method: "post",
  tags: ["reviews-command"],
  operationId: "closeReview",
  path: "/reviews/{reviewId}/close",
  request: {
    params: reviewIdParams,
  },
  responses: {
    200: {
      description: "クローズ成功。更新後のReviewを返す。",
      content: { "application/json": { schema: ReviewSchema } },
    },
    404: notFoundResponse,
    409: {
      description: "クローズ不可 (対応未完了 — LST-A08 表示条件を満たさない)。",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

/**
 * Cycle 9 (スキーマ+ルート定義) 時点のハンドラは reviews.yaml の example を
 * 固定で返すスタブ。以下はスコープ外 (後続タスク):
 * - DB 永続化、実データの検索・フィルタ・ページング
 * - Idempotency-Key の重複排除・payload比較・200 replay分岐
 * - Review/ReviewAttempt の状態遷移検証、404/409/502/503 の実到達
 * - AI Agent 呼び出し、Valkey 流量制御
 */
export function registerReviewsRoutes(app: OpenAPIHono) {
  app.openapi(listReviewsRoute, (c) => c.json(REVIEW_LIST_EXAMPLE, 200));

  app.openapi(registerReviewRoute, (c) => {
    c.header("Location", `/reviews/${REVIEW_DRAFT_EXAMPLE.reviewId}`);
    return c.json(REVIEW_DRAFT_EXAMPLE, 201);
  });

  app.openapi(getReviewRoute, (c) => c.json(REVIEW_REVIEWED_EXAMPLE, 200));

  app.openapi(getReviewReportRoute, (c) => c.json(REVIEW_REPORT_EXAMPLE, 200));

  app.openapi(startReviewAttemptRoute, (c) => c.json(REVIEW_ATTEMPT_QUEUED_EXAMPLE, 202));

  app.openapi(getReviewAttemptRoute, (c) => c.json(REVIEW_ATTEMPT_QUEUED_EXAMPLE, 200));

  app.openapi(cancelReviewAttemptRoute, (c) => c.json(REVIEW_ATTEMPT_CANCELED_EXAMPLE, 200));

  app.openapi(applyCommentDispositionRoute, (c) => c.json(REVIEW_COMMENT_EXAMPLE, 200));

  app.openapi(closeReviewRoute, (c) => c.json(REVIEW_CLOSED_EXAMPLE, 200));
}
