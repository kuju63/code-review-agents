import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { API_VERSION } from "../../app.js";
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
import { createReviewsStore, type ReviewsStore } from "./reviews.store.js";

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

function errorResponse(code: "not_found" | "conflict", message: string) {
  return ErrorResponseSchema.parse({ apiVersion: API_VERSION, code, message, detail: null });
}

const NOT_FOUND_MESSAGE = "指定されたレビューは存在しないか、参照できません。";

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
 * `store` (既定値は mock-data.js 由来のダミーストア `reviews.store.ts`) をDIし、
 * その判別可能ユニオンの戻り値をHTTPステータス・ErrorResponseへ変換する。
 * 以下は引き続きスコープ外 (後続タスク):
 * - DB 永続化
 * - Idempotency-Key の重複排除・payload比較・200 replay分岐
 * - AI Agent 呼び出し、Valkey 流量制御
 */
export function registerReviewsRoutes(
  app: OpenAPIHono,
  store: ReviewsStore = createReviewsStore(),
) {
  app.openapi(listReviewsRoute, (c) => {
    const query = c.req.valid("query");
    const { items, pageInfo } = store.listReviews(query);
    return c.json({ apiVersion: API_VERSION, items, pageInfo }, 200);
  });

  app.openapi(registerReviewRoute, (c) => {
    const body = c.req.valid("json");
    const result = store.registerReview(body);
    if (result.created) {
      c.header("Location", `/reviews/${result.data.reviewId}`);
      return c.json(result.data, 201);
    }
    return c.json(result.data, 200);
  });

  app.openapi(getReviewRoute, (c) => {
    const { reviewId } = c.req.valid("param");
    const result = store.getReview(reviewId);
    if (!result.ok) {
      return c.json(errorResponse("not_found", NOT_FOUND_MESSAGE), 404);
    }
    return c.json(result.data, 200);
  });

  app.openapi(getReviewReportRoute, (c) => {
    const { reviewId } = c.req.valid("param");
    const result = store.getReport(reviewId);
    if (!result.ok) {
      if (result.code === "not_found") {
        return c.json(errorResponse("not_found", NOT_FOUND_MESSAGE), 404);
      }
      return c.json(errorResponse("conflict", "レビュー結果はまだ確定していません。"), 409);
    }
    return c.json(result.data, 200);
  });

  app.openapi(startReviewAttemptRoute, (c) => {
    const { reviewId } = c.req.valid("param");
    const result = store.startAttempt(reviewId);
    if (!result.ok) {
      if (result.code === "not_found") {
        return c.json(errorResponse("not_found", NOT_FOUND_MESSAGE), 404);
      }
      return c.json(errorResponse("conflict", "クローズ済みのレビューは再実行できません。"), 409);
    }
    return c.json(result.data, 202);
  });

  app.openapi(getReviewAttemptRoute, (c) => {
    const { reviewId, attemptId } = c.req.valid("param");
    const result = store.getAttempt(reviewId, attemptId);
    if (!result.ok) {
      return c.json(errorResponse("not_found", NOT_FOUND_MESSAGE), 404);
    }
    return c.json(result.data, 200);
  });

  app.openapi(cancelReviewAttemptRoute, (c) => {
    const { reviewId, attemptId } = c.req.valid("param");
    const result = store.cancelAttempt(reviewId, attemptId);
    if (!result.ok) {
      if (result.code === "not_found") {
        return c.json(errorResponse("not_found", NOT_FOUND_MESSAGE), 404);
      }
      return c.json(
        errorResponse("conflict", "既に終了したレビュー実行はキャンセルできません。"),
        409,
      );
    }
    return c.json(result.data, 200);
  });

  app.openapi(applyCommentDispositionRoute, (c) => {
    const { reviewId, attemptId } = c.req.valid("param");
    const { commentId, disposition } = c.req.valid("json");
    const result = store.applyDisposition(reviewId, attemptId, commentId, disposition);
    if (!result.ok) {
      if (result.code === "not_found") {
        return c.json(errorResponse("not_found", NOT_FOUND_MESSAGE), 404);
      }
      return c.json(
        errorResponse("conflict", "指定された対応状態の遷移は許可されていません。"),
        409,
      );
    }
    return c.json(result.data, 200);
  });

  app.openapi(closeReviewRoute, (c) => {
    const { reviewId } = c.req.valid("param");
    const result = store.closeReview(reviewId);
    if (!result.ok) {
      if (result.code === "not_found") {
        return c.json(errorResponse("not_found", NOT_FOUND_MESSAGE), 404);
      }
      return c.json(
        errorResponse("conflict", "未対応のコメントが残っているためクローズできません。"),
        409,
      );
    }
    return c.json(result.data, 200);
  });
}
