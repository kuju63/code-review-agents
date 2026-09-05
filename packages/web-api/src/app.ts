import { OpenAPIHono } from "@hono/zod-openapi";
import { ErrorResponseSchema } from "./modules/reviews/reviews.schema.js";

/** REST `/reviews` surface の契約バージョン (ADR-0012 §4)。 */
export const API_VERSION = "1.0.0";

export function createApp() {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        const body = ErrorResponseSchema.parse({
          apiVersion: API_VERSION,
          code: "validation_error",
          message: "リクエストの検証に失敗しました。",
          detail: result.error.issues.map((issue) => issue.message).join("; "),
        });
        return c.json(body, 422);
      }
    },
  });
}
