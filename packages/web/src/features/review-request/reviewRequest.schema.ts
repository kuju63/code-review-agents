import { z } from "zod";

/**
 * Client-side mirror of the subset of `docs/openapi/reviews.yaml` that SCR-02
 * consumes (`/github/orgs`, `/github/repos`, `/github/prs`, `POST /reviews`).
 * Deliberately does not import `packages/web-api`'s schema module — see
 * `packages/web/src/features/review-list/reviews.schema.ts` for why.
 */
export const GithubOrgSchema = z.object({
  name: z.string(),
  id: z.number().int(),
});

export const GithubOrgListResponseSchema = z.object({
  apiVersion: z.string(),
  items: z.array(GithubOrgSchema),
});

export const GithubRepositorySchema = z.object({
  name: z.string(),
  id: z.number().int(),
  defaultBranch: z.string(),
  openIssuesCount: z.number().int().min(0),
});

export const GithubRepositoryListResponseSchema = z.object({
  apiVersion: z.string(),
  items: z.array(GithubRepositorySchema),
});

/** PR一覧は`/github/prs`がサーバー側で`state=open`固定のため、実際は常に"open"。 */
export const PrStateSchema = z.enum(["open", "closed", "merged"]);

export const GithubPullRequestSchema = z.object({
  number: z.number().int().min(1),
  title: z.string(),
  state: PrStateSchema,
  createdAt: z.iso.datetime({ offset: true }),
  author: z.string(),
  baseBranch: z.string(),
});

export const GithubPullRequestListResponseSchema = z.object({
  apiVersion: z.string(),
  items: z.array(GithubPullRequestSchema),
});

/** RR-10送信データ。`commitSha`は`/github/prs`から取得できないため送信しない(スコープ境界)。 */
export const RegisterReviewRequestSchema = z.object({
  organization: z.string().min(1),
  repository: z.string().min(1),
  pullRequest: z.number().int().min(1),
});

/** `POST /reviews`レスポンスのうち、送信完了通知の遷移先文字列の組み立てに必要な部分のみ。 */
export const ReviewSchema = z.object({
  reviewId: z.string(),
  organization: z.string(),
  repository: z.string(),
  pullRequest: z.number().int().min(1),
});

export const ErrorResponseSchema = z.object({
  apiVersion: z.string(),
  code: z.string(),
  message: z.string(),
  detail: z.string().nullable(),
});

export type GithubOrg = z.infer<typeof GithubOrgSchema>;
export type GithubRepository = z.infer<typeof GithubRepositorySchema>;
export type PrState = z.infer<typeof PrStateSchema>;
export type GithubPullRequest = z.infer<typeof GithubPullRequestSchema>;
export type RegisterReviewRequest = z.infer<typeof RegisterReviewRequestSchema>;
export type Review = z.infer<typeof ReviewSchema>;
