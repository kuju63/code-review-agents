import {
  ReviewAttemptSchema,
  ReviewCommentSchema,
  ReviewListResponseSchema,
  ReviewReportSchema,
  ReviewSchema,
} from "./reviews.schema.js";

/**
 * Cycle 9 時点のハンドラは DB 永続化を持たないため、reviews.yaml の examples を
 * `.parse()` で検証した固定値として返す。実データ検索・Idempotency-Key replay・
 * 状態遷移はスコープ外 (後続タスク) — reviews.route.ts の TODO を参照。
 */

/** reviews.yaml `components/examples/ReviewListExample` の再現。 */
export const REVIEW_LIST_EXAMPLE = ReviewListResponseSchema.parse({
  apiVersion: "1.0.0",
  items: [
    {
      apiVersion: "1.0.0",
      reviewId: "pr-482",
      organization: "acme-corp",
      repository: "web-frontend",
      pullRequest: 482,
      title: "ユーザー認証フローの改善",
      branch: "feature/auth-flow",
      baseBranch: "main",
      author: "sato.k",
      commitSha: "a3f9c2e8d4b1f67a2c9e5d0b8f3a71c6e9d4b2a1",
      prState: "open",
      status: "reviewed",
      reviewStatus: "waiting",
      latestAttemptId: "att-9f2c",
      commentCounts: { total: 4, open: 2, resolved: 1, falsePositive: 1 },
      errorMessage: null,
      createdAt: "2026-08-09T10:00:00Z",
      updatedAt: "2026-08-09T10:24:00Z",
    },
    {
      apiVersion: "1.0.0",
      reviewId: "pr-490",
      organization: "acme-corp",
      repository: "web-frontend",
      pullRequest: 490,
      title: "国際化対応の追加",
      branch: "feature/i18n",
      baseBranch: "main",
      author: "suzuki.t",
      commitSha: "5c1e8a9f2b6d4c7e0a3f9b5d1c8e6a2f4b7d9c0e",
      prState: "open",
      status: "reviewing",
      reviewStatus: "analyzing",
      latestAttemptId: "att-1b3d",
      commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
      errorMessage: null,
      createdAt: "2026-08-09T12:00:00Z",
      updatedAt: "2026-08-09T13:05:00Z",
    },
    {
      apiVersion: "1.0.0",
      reviewId: "pr-210",
      organization: "acme-corp",
      repository: "payments-api",
      pullRequest: 210,
      title: "Webhookリトライ処理の実装",
      branch: "feature/webhook-retry",
      baseBranch: "main",
      author: "suzuki.t",
      commitSha: "f1e4d7c0b3a6f9e2d5c8b1a4f7e0d3c6b9a2f5e8",
      prState: "open",
      status: "failed",
      reviewStatus: "error",
      latestAttemptId: "att-7e0d",
      commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
      errorMessage: "解析中にタイムアウトが発生し、レビューを完了できませんでした。",
      createdAt: "2026-08-09T11:00:00Z",
      updatedAt: "2026-08-09T11:50:00Z",
    },
  ],
  pageInfo: { page: 1, perPage: 30, totalItems: 3, totalPages: 1 },
});

/** reviews.yaml `components/examples/ReviewDraftExample` の再現。 */
export const REVIEW_DRAFT_EXAMPLE = ReviewSchema.parse({
  apiVersion: "1.0.0",
  reviewId: "pr-486",
  organization: "acme-corp",
  repository: "web-frontend",
  pullRequest: 486,
  title: null,
  branch: null,
  baseBranch: null,
  author: null,
  commitSha: null,
  prState: "open",
  status: "draft",
  reviewStatus: "not_started",
  latestAttemptId: null,
  commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
  errorMessage: null,
  createdAt: "2026-08-10T09:00:00Z",
  updatedAt: "2026-08-10T09:00:00Z",
});

/** reviews.yaml `components/examples/ReviewReviewedExample` の再現。 */
export const REVIEW_REVIEWED_EXAMPLE = ReviewSchema.parse({
  apiVersion: "1.0.0",
  reviewId: "pr-482",
  organization: "acme-corp",
  repository: "web-frontend",
  pullRequest: 482,
  title: "ユーザー認証フローの改善",
  branch: "feature/auth-flow",
  baseBranch: "main",
  author: "sato.k",
  commitSha: "a3f9c2e8d4b1f67a2c9e5d0b8f3a71c6e9d4b2a1",
  prState: "open",
  status: "reviewed",
  reviewStatus: "waiting",
  latestAttemptId: "att-9f2c",
  commentCounts: { total: 4, open: 2, resolved: 1, falsePositive: 1 },
  errorMessage: null,
  createdAt: "2026-08-09T10:00:00Z",
  updatedAt: "2026-08-09T10:24:00Z",
});

/**
 * `Review.status = closed` 版の派生フィクスチャ (`POST /reviews/{reviewId}/close`)。
 * reviews.yaml に専用 example がないため REVIEW_REVIEWED_EXAMPLE から自作する。
 */
export const REVIEW_CLOSED_EXAMPLE = ReviewSchema.parse({
  ...REVIEW_REVIEWED_EXAMPLE,
  status: "closed",
});

/** reviews.yaml `components/examples/ReviewAttemptQueuedExample` の再現。 */
export const REVIEW_ATTEMPT_QUEUED_EXAMPLE = ReviewAttemptSchema.parse({
  apiVersion: "1.0.0",
  attemptId: "att-9f2c",
  reviewId: "pr-482",
  status: "queued",
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-08-09T10:20:00Z",
  startedAt: null,
  finishedAt: null,
});

/**
 * `AttemptStatus = canceled` 版の派生フィクスチャ (`POST .../cancel`)。
 * reviews.yaml に専用 example がないため REVIEW_ATTEMPT_QUEUED_EXAMPLE から自作する。
 */
export const REVIEW_ATTEMPT_CANCELED_EXAMPLE = ReviewAttemptSchema.parse({
  ...REVIEW_ATTEMPT_QUEUED_EXAMPLE,
  status: "canceled",
});

/** reviews.yaml `components/examples/ReviewReportExample` の再現。 */
export const REVIEW_REPORT_EXAMPLE = ReviewReportSchema.parse({
  apiVersion: "1.0.0",
  reviewId: "pr-482",
  attemptId: "att-9f2c",
  overallSummary: "認証フローの改善。セキュリティ観点で2件の対応推奨。",
  commentCounts: { total: 2, open: 1, resolved: 1, falsePositive: 0 },
  files: [
    {
      filePath: "src/components/Button.tsx",
      status: "M",
      additions: 3,
      deletions: 2,
      lines: [
        { type: "ctx", oldLine: 12, newLine: 12, text: "  return (" },
        {
          type: "del",
          oldLine: 14,
          newLine: null,
          text: '    <button onClick={onClick} disabled={disabled} className="btn">',
        },
        {
          type: "add",
          oldLine: null,
          newLine: 14,
          text: '    <button onClick={onClick} disabled={disabled || loading} className="btn">',
        },
      ],
      comments: [
        {
          commentId: "c1",
          filePath: "src/components/Button.tsx",
          line: 12,
          category: "Style",
          severity: "low",
          impactCategory: "maintainability",
          body: "loading のような boolean フラグは isLoading のように is / has 接頭辞を付けると統一感が出ます。",
          disposition: "resolved",
        },
        {
          commentId: "c2",
          filePath: "src/components/Button.tsx",
          line: 14,
          category: "Best Practice",
          severity: "medium",
          impactCategory: "maintainability",
          body: "外部からも状態が伝わるよう aria-busy 属性の付与を推奨します。",
          disposition: "open",
        },
      ],
    },
  ],
});

/**
 * `POST .../disposition` の200レスポンス用フィクスチャ。
 * REVIEW_REPORT_EXAMPLE.files[0].comments[0] から1件取り出したもの。
 */
export const REVIEW_COMMENT_EXAMPLE = ReviewCommentSchema.parse(
  REVIEW_REPORT_EXAMPLE.files[0]?.comments?.[0],
);
