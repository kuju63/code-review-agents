import { z } from "@hono/zod-openapi";

/** 契約バージョン (ADR-0012 §4, npm semver不使用)。 */
export const ApiVersionSchema = z.string().openapi("ApiVersion");

/**
 * コメント件数の内訳 (SCR-01 LST-16 / mock countComments)。
 * `open` が未解決件数で reviewStatus(waiting/completed) の判定に使う。
 */
export const CommentCountsSchema = z
  .object({
    total: z.number().int().min(0),
    open: z.number().int().min(0),
    resolved: z.number().int().min(0),
    falsePositive: z.number().int().min(0),
  })
  .openapi("CommentCounts");
