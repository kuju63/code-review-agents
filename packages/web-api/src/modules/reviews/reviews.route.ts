import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { REVIEW_LIST_EXAMPLE } from "./reviews.fixtures.js";
import { ListReviewsQuerySchema } from "./reviews.params.js";
import { ErrorResponseSchema, ReviewListResponseSchema } from "./reviews.schema.js";

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
    422: {
      description: "入力検証失敗 (validation_error)。",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export function registerReviewsRoutes(app: OpenAPIHono) {
  // Cycle 9 時点では DB 永続化がないため、フィルタ・ページングは無視して
  // reviews.yaml の example を固定で返す。実データ検索は後続タスク。
  app.openapi(listReviewsRoute, (c) => c.json(REVIEW_LIST_EXAMPLE, 200));
}
