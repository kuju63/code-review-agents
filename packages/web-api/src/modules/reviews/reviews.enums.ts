import { z } from "@hono/zod-openapi";

/** GitHub上のPR状態 (LST-15)。 */
export const PrStateSchema = z.enum(["open", "closed", "merged"]).openapi("PrState");

/**
 * サーバが計算した表示用レビュー状態 (SCR-01 §4)。
 * ReviewDomainStatusSchema と名前は似ているが別軸の値であり、統合しない。
 */
export const ReviewStatusSchema = z
  .enum(["not_started", "analyzing", "waiting", "completed", "error"])
  .openapi("ReviewStatus");

/**
 * Review の永続ドメイン状態 (ADR-0012 §3)。`reviewStatus` の計算元。
 * ReviewStatusSchema と名前は似ているが別軸の値であり、統合しない。
 */
export const ReviewDomainStatusSchema = z
  .enum(["draft", "reviewing", "reviewed", "failed", "closed", "canceled"])
  .openapi("ReviewDomainStatus");

/** ReviewAttempt の実行状態 (ADR-0012 §3 status mapping)。 */
export const AttemptStatusSchema = z
  .enum(["queued", "running", "succeeded", "failed", "canceled"])
  .openapi("AttemptStatus");

/** 共通 error taxonomy (ADR-0012 §6)。 */
export const ErrorCodeSchema = z
  .enum([
    "validation_error",
    "not_found",
    "conflict",
    "queue_overload",
    "upstream_github_failure",
    "upstream_model_failure",
    "timeout",
    "canceled",
  ])
  .openapi("ErrorCode");

/**
 * コメント(finding)の対応状態 (SCR-03 / mock COMMENT_STATE_TAG)。
 * status machineの一部ではない別軸属性 (ADR-0012 §3)。
 */
export const CommentDispositionSchema = z
  .enum(["open", "resolved", "false_positive"])
  .openapi("CommentDisposition");

/** レビューコメントのカテゴリ (SCR-03 RES-13)。 */
export const FindingCategorySchema = z
  .enum(["Security", "Performance", "Best Practice", "Style"])
  .openapi("FindingCategory");

/** FindingDecision.severity (agent-core lead-engineer.ts)。 */
export const FindingSeveritySchema = z
  .enum(["critical", "high", "medium", "low"])
  .openapi("FindingSeverity");

/** FindingDecision.impactCategory (agent-core lead-engineer.ts)。 */
export const FindingImpactSchema = z
  .enum(["security", "correctness", "performance", "maintainability"])
  .openapi("FindingImpact");

/** 変更種別 (SCR-03 RES-08 / mock FILE_BADGE)。M=変更, A=追加, D=削除。 */
export const FileChangeStatusSchema = z.enum(["M", "A", "D"]).openapi("FileChangeStatus");
