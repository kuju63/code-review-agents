import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { API_VERSION } from "../../app.js";
import { ErrorResponseSchema } from "../reviews/reviews.schema.js";
import { GithubSettingsSchema, UpdateGithubSettingsRequestSchema } from "./settings.schema.js";
import { createSettingsStore, type SettingsStore } from "./settings.store.js";

const validationErrorResponse = {
  description: "入力検証失敗 (validation_error)。",
  content: { "application/json": { schema: ErrorResponseSchema } },
} as const;

const getGithubSettingsRoute = createRoute({
  method: "get",
  tags: ["settings-query"],
  operationId: "getGithubSettings",
  path: "/settings/github",
  responses: {
    200: {
      description: "取得成功。",
      content: { "application/json": { schema: GithubSettingsSchema } },
    },
  },
});

const updateGithubSettingsRoute = createRoute({
  method: "put",
  tags: ["settings-command"],
  operationId: "updateGithubSettings",
  path: "/settings/github",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: UpdateGithubSettingsRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "保存成功。更新後の設定を返す。",
      content: { "application/json": { schema: GithubSettingsSchema } },
    },
    422: validationErrorResponse,
  },
});

/**
 * `store` (既定値は mock-data 由来のダミーストア `settings.store.ts`) をDIし、
 * その判別可能ユニオンの戻り値をHTTPステータス・ErrorResponseへ変換する。
 * DB永続化・暗号化は引き続きスコープ外 (後続タスク、settings.store.ts参照)。
 */
export function registerSettingsRoutes(
  app: OpenAPIHono,
  store: SettingsStore = createSettingsStore(),
) {
  app.openapi(getGithubSettingsRoute, (c) => {
    return c.json(store.getGithubSettings(), 200);
  });

  app.openapi(updateGithubSettingsRoute, (c) => {
    const body = c.req.valid("json");
    const result = store.updateGithubSettings(body);
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({
          apiVersion: API_VERSION,
          code: result.code,
          message: result.message,
          detail: null,
        }),
        422,
      );
    }
    return c.json(result.data, 200);
  });
}
