import { z } from "@hono/zod-openapi";
import {
  AttemptStatusSchema,
  CommentDispositionSchema,
  ErrorCodeSchema,
  FileChangeStatusSchema,
  FindingCategorySchema,
  FindingImpactSchema,
  FindingSeveritySchema,
  PrStateSchema,
  ReviewDomainStatusSchema,
  ReviewStatusSchema,
} from "./reviews.enums.js";

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
  .superRefine((value, ctx) => {
    if (value.total !== value.open + value.resolved + value.falsePositive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "total must equal open + resolved + falsePositive",
        path: ["total"],
      });
    }
  })
  .openapi("CommentCounts");

/** 共通エラー応答 (ADR-0012 §6 error taxonomy)。 */
export const ErrorResponseSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    code: ErrorCodeSchema,
    message: z.string(),
    detail: z.string().nullable().default(null),
  })
  .openapi("ErrorResponse");

/**
 * 差分1行 (SCR-03 RES-12 / mock file.lines)。
 * type=ctx(文脈)/add(追加)/del(削除)。追加行は oldLine=null、削除行は newLine=null。
 */
export const DiffLineSchema = z
  .object({
    type: z.enum(["ctx", "add", "del"]),
    oldLine: z.number().int().nullable().default(null),
    newLine: z.number().int().nullable().default(null),
    text: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "add" && value.oldLine !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "oldLine must be null when type is add",
        path: ["oldLine"],
      });
    }
    if (value.type === "del" && value.newLine !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "newLine must be null when type is del",
        path: ["newLine"],
      });
    }
  })
  .openapi("DiffLine");

/**
 * 差分の対象行に紐づくレビューコメント。`LeadEngineerReport.decisions` の
 * 1件に対応し、対応状態 (disposition) を付与したもの (SCR-03 RES-13)。
 * 他の2xxエンベロープと異なり apiVersion フィールドを持たない
 * (`POST .../disposition` の200レスポンスがこのスキーマをそのまま返すため)。
 */
export const ReviewCommentSchema = z
  .object({
    commentId: z.string(),
    filePath: z.string().nullable().default(null),
    line: z.number().int().nullable().default(null),
    category: FindingCategorySchema,
    severity: FindingSeveritySchema,
    impactCategory: FindingImpactSchema.optional(),
    body: z.string(),
    disposition: CommentDispositionSchema,
  })
  .openapi("ReviewComment");

/**
 * 変更ファイル1件と、その行にマッピングされたレビューコメント (SCR-03)。
 * agent-core の FileChange を UI表示用に拡張したもの。
 */
export const ReviewFileChangeSchema = z
  .object({
    filePath: z.string(),
    status: FileChangeStatusSchema,
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    lines: z.array(DiffLineSchema).optional(),
    comments: z.array(ReviewCommentSchema).optional(),
  })
  .openapi("ReviewFileChange");

/**
 * レビュー対象の登録単位 (ADR-0012 §3)。`status` は永続ドメイン状態、
 * `reviewStatus` はサーバ計算の表示値。名前は似ているが別軸の必須フィールドであり、
 * 統合しない (ReviewStatusSchema / ReviewDomainStatusSchema 参照)。
 */
export const ReviewSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    reviewId: z.string(),
    organization: z.string(),
    repository: z.string(),
    pullRequest: z.number().int().min(1),
    title: z.string().nullable().default(null),
    branch: z.string().nullable().default(null),
    baseBranch: z.string().nullable().default(null),
    author: z.string().nullable().default(null),
    commitSha: z.string().nullable().default(null),
    prState: PrStateSchema,
    status: ReviewDomainStatusSchema,
    reviewStatus: ReviewStatusSchema,
    latestAttemptId: z.string().nullable().default(null),
    commentCounts: CommentCountsSchema,
    errorMessage: z.string().nullable().default(null),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .openapi("Review");

/** 1回のレビュー実行 (ADR-0012 §3)。attemptId は transport taskId と同値。 */
export const ReviewAttemptSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    attemptId: z.string(),
    reviewId: z.string(),
    status: AttemptStatusSchema,
    errorCode: ErrorCodeSchema.nullable().default(null),
    errorMessage: z.string().nullable().default(null),
    createdAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable().default(null),
    finishedAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .openapi("ReviewAttempt");

/** レビュー対象登録 (SCR-02 送信データ)。 */
export const RegisterReviewRequestSchema = z
  .object({
    organization: z.string().min(1),
    repository: z.string().min(1),
    pullRequest: z.number().int().min(1),
    commitSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
  })
  .openapi("RegisterReviewRequest");

/**
 * レビュー実行開始の任意パラメータ。modelId のみクライアント指定可能で
 * サーバ側 allowlist で検証する。providerType/llmBaseUrl は指定不可 (ADR-0012 §5)。
 */
export const StartAttemptRequestSchema = z
  .object({
    modelId: z.string().optional(),
  })
  .openapi("StartAttemptRequest");

export const DispositionRequestSchema = z
  .object({
    commentId: z.string(),
    disposition: CommentDispositionSchema,
  })
  .openapi("DispositionRequest");

export const PageInfoSchema = z
  .object({
    page: z.number().int().min(1),
    perPage: z.number().int().min(1),
    totalItems: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  })
  .openapi("PageInfo");

export const ReviewListResponseSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    items: z.array(ReviewSchema),
    pageInfo: PageInfoSchema,
  })
  .openapi("ReviewListResponse");

/**
 * レビュー結果 (SCR-03)。変更ファイル×レビューコメントのマッピング済み表現。
 * `attemptId` は required リストになく `type:[T,'null']` でもないため、
 * nullable ではなく optional として扱う (Review 等の他のnullableフィールドと混同しない)。
 */
export const ReviewReportSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    reviewId: z.string(),
    attemptId: z.string().optional(),
    overallSummary: z.string(),
    files: z.array(ReviewFileChangeSchema),
    commentCounts: CommentCountsSchema,
  })
  .openapi("ReviewReport");
