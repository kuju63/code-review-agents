import { z } from "@hono/zod-openapi";
import { ReviewStatusSchema } from "./reviews.enums.js";

/** Review の永続識別子。 */
export const ReviewIdParamSchema = z.string().openapi({
  param: { name: "reviewId", in: "path" },
  example: "pr-482",
});

/** ReviewAttempt の識別子 (transport-level taskId と同値)。 */
export const AttemptIdParamSchema = z.string().openapi({
  param: { name: "attemptId", in: "path" },
  example: "att-9f2c",
});

/**
 * 同一論理リクエストの再送を識別するキー (ADR-0012 §6)。
 * ヘッダ自体はスキーマ上optionalだが、`POST /reviews` と
 * `POST /reviews/{reviewId}/attempts` では不変条件として必須運用する。
 */
export const IdempotencyKeyHeaderSchema = z.object({
  "Idempotency-Key": z
    .string()
    .optional()
    .openapi({
      param: { name: "Idempotency-Key", in: "header" },
      example: "3f8c1e2a-...",
    }),
});

/**
 * `GET /reviews` のクエリパラメータ (LST-A02, LST-08, LST-09, LST-A08)。
 * `includeClosed` は `z.coerce.boolean()` を使わない — `"false"` も `true` に
 * 変換されてしまう既知の罠があるため、enum + transform で明示的に変換する。
 */
export const ListReviewsQuerySchema = z.object({
  org: z
    .string()
    .optional()
    .openapi({ param: { name: "org", in: "query" }, example: "acme-corp" }),
  repo: z
    .string()
    .optional()
    .openapi({ param: { name: "repo", in: "query" }, example: "web-frontend" }),
  reviewStatus: ReviewStatusSchema.optional().openapi({
    param: { name: "reviewStatus", in: "query" },
  }),
  q: z
    .string()
    .optional()
    .openapi({ param: { name: "q", in: "query" }, example: "auth" }),
  includeClosed: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
    .openapi({ param: { name: "includeClosed", in: "query" } }),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1)
    .openapi({ param: { name: "page", in: "query" } }),
  perPage: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .openapi({ param: { name: "perPage", in: "query" } }),
});
