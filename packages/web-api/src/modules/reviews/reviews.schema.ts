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
