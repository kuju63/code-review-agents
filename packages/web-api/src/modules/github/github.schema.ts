import { z } from "@hono/zod-openapi";
import { PrStateSchema } from "../reviews/reviews.enums.js";
import { ApiVersionSchema } from "../reviews/reviews.schema.js";

/** GitHub Organization/user (Issue #335 `/github/orgs`)。 */
export const GithubOrgSchema = z
  .object({
    name: z.string(),
    id: z.number().int(),
  })
  .openapi("GithubOrg");

/** Organization一覧レスポンス (Issue #335)。 */
export const GithubOrgListResponseSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    items: z.array(GithubOrgSchema),
  })
  .openapi("GithubOrgListResponse");

/** GitHub Repository (Issue #335 `/github/repos`)。 */
export const GithubRepositorySchema = z
  .object({
    name: z.string(),
    id: z.number().int(),
    defaultBranch: z.string(),
    openIssuesCount: z.number().int().min(0),
  })
  .openapi("GithubRepository");

/** Repository一覧レスポンス (Issue #335)。 */
export const GithubRepositoryListResponseSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    items: z.array(GithubRepositorySchema),
  })
  .openapi("GithubRepositoryListResponse");

/** GitHub Open Pull Request (Issue #335 `/github/prs`)。 */
export const GithubPullRequestSchema = z
  .object({
    number: z.number().int().min(1),
    title: z.string(),
    state: PrStateSchema,
    createdAt: z.string().datetime({ offset: true }),
    author: z.string(),
    baseBranch: z.string(),
  })
  .openapi("GithubPullRequest");

/** Open PR一覧レスポンス (Issue #335)。 */
export const GithubPullRequestListResponseSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    items: z.array(GithubPullRequestSchema),
  })
  .openapi("GithubPullRequestListResponse");

/** `GET /github/repos` のクエリパラメータ (Issue #335)。 */
export const GithubOrgQuerySchema = z.object({
  org: z
    .string()
    .min(1)
    .openapi({ param: { name: "org", in: "query" }, example: "acme-corp" }),
});

/** `GET /github/prs` のクエリパラメータ (Issue #335)。 */
export const GithubRepoQuerySchema = GithubOrgQuerySchema.extend({
  repo: z
    .string()
    .min(1)
    .openapi({ param: { name: "repo", in: "query" }, example: "web-frontend" }),
});
