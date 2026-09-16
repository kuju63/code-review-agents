import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { API_VERSION } from "../../app.js";
import { ErrorResponseSchema } from "../reviews/reviews.schema.js";
import {
  createSettingsStore,
  type GithubCredentials,
  type SettingsStore,
} from "../settings/settings.store.js";
import {
  type GithubApiClientOptions,
  listGithubOrgs,
  listGithubPullRequests,
  listGithubRepositories,
} from "./github.client.js";
import {
  GithubOrgListResponseSchema,
  GithubOrgQuerySchema,
  GithubPullRequestListResponseSchema,
  GithubRepoQuerySchema,
  GithubRepositoryListResponseSchema,
} from "./github.schema.js";

function failureStatus(code: "unauthorized" | "upstream_github_failure"): 401 | 502 {
  return code === "unauthorized" ? 401 : 502;
}

const unauthorizedResponse = {
  description: "GitHub連携未設定、またはPersonal Access Tokenが無効 (unauthorized)。",
  content: { "application/json": { schema: ErrorResponseSchema } },
} as const;

const upstreamGithubFailureResponse = {
  description: "GitHub上流呼び出し失敗 (upstream_github_failure)。",
  content: { "application/json": { schema: ErrorResponseSchema } },
} as const;

const validationErrorResponse = {
  description: "入力検証失敗 (validation_error)。",
  content: { "application/json": { schema: ErrorResponseSchema } },
} as const;

const listGithubOrgsRoute = createRoute({
  method: "get",
  tags: ["github-query"],
  operationId: "listGithubOrgs",
  path: "/github/orgs",
  responses: {
    200: {
      description: "取得成功。",
      content: { "application/json": { schema: GithubOrgListResponseSchema } },
    },
    401: unauthorizedResponse,
    502: upstreamGithubFailureResponse,
  },
});

const listGithubRepositoriesRoute = createRoute({
  method: "get",
  tags: ["github-query"],
  operationId: "listGithubRepositories",
  path: "/github/repos",
  request: {
    query: GithubOrgQuerySchema,
  },
  responses: {
    200: {
      description: "取得成功。",
      content: { "application/json": { schema: GithubRepositoryListResponseSchema } },
    },
    401: unauthorizedResponse,
    422: validationErrorResponse,
    502: upstreamGithubFailureResponse,
  },
});

const listGithubPullRequestsRoute = createRoute({
  method: "get",
  tags: ["github-query"],
  operationId: "listGithubPullRequests",
  path: "/github/prs",
  request: {
    query: GithubRepoQuerySchema,
  },
  responses: {
    200: {
      description: "取得成功。",
      content: { "application/json": { schema: GithubPullRequestListResponseSchema } },
    },
    401: unauthorizedResponse,
    422: validationErrorResponse,
    502: upstreamGithubFailureResponse,
  },
});

function errorBody(code: "unauthorized" | "upstream_github_failure", message: string) {
  return ErrorResponseSchema.parse({ apiVersion: API_VERSION, code, message, detail: null });
}

const NO_CREDENTIALS_MESSAGE =
  "GitHub連携が未設定か、Personal Access Tokenが無効です。設定を確認してください。";

/**
 * `store.getCredentials()` (Issue #335) をDIし、GitHub呼び出し前に
 * PAT未登録を検知して即 `401 unauthorized` を返す。実際のGitHub呼び出しは
 * `github.client.ts` の discriminated union をHTTPステータスへ変換する。
 */
export function registerGithubRoutes(
  app: OpenAPIHono,
  store: SettingsStore = createSettingsStore(),
  clientOptions: GithubApiClientOptions = {},
) {
  function requireCredentials(): GithubCredentials | null {
    return store.getCredentials();
  }

  app.openapi(listGithubOrgsRoute, async (c) => {
    const credentials = requireCredentials();
    if (!credentials) {
      return c.json(errorBody("unauthorized", NO_CREDENTIALS_MESSAGE), 401);
    }
    const result = await listGithubOrgs(credentials, clientOptions);
    if (!result.ok) {
      return c.json(errorBody(result.code, result.message), failureStatus(result.code));
    }
    return c.json(
      GithubOrgListResponseSchema.parse({ apiVersion: API_VERSION, items: result.data }),
      200,
    );
  });

  app.openapi(listGithubRepositoriesRoute, async (c) => {
    const { org } = c.req.valid("query");
    const credentials = requireCredentials();
    if (!credentials) {
      return c.json(errorBody("unauthorized", NO_CREDENTIALS_MESSAGE), 401);
    }
    const result = await listGithubRepositories(credentials, org, clientOptions);
    if (!result.ok) {
      return c.json(errorBody(result.code, result.message), failureStatus(result.code));
    }
    return c.json(
      GithubRepositoryListResponseSchema.parse({ apiVersion: API_VERSION, items: result.data }),
      200,
    );
  });

  app.openapi(listGithubPullRequestsRoute, async (c) => {
    const { org, repo } = c.req.valid("query");
    const credentials = requireCredentials();
    if (!credentials) {
      return c.json(errorBody("unauthorized", NO_CREDENTIALS_MESSAGE), 401);
    }
    const result = await listGithubPullRequests(credentials, org, repo, clientOptions);
    if (!result.ok) {
      return c.json(errorBody(result.code, result.message), failureStatus(result.code));
    }
    return c.json(
      GithubPullRequestListResponseSchema.parse({ apiVersion: API_VERSION, items: result.data }),
      200,
    );
  });
}
