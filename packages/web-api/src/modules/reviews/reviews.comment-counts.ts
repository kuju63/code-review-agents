import type { z } from "@hono/zod-openapi";
import type { CommentCountsSchema, ReviewFileChangeSchema } from "./reviews.schema.js";

type ReviewFileChange = z.infer<typeof ReviewFileChangeSchema>;
type CommentCounts = z.infer<typeof CommentCountsSchema>;

/**
 * `files[].comments[].disposition` を集計する。Review.commentCounts /
 * ReviewReport.commentCounts の唯一の導出元 (mock-seed の初期値・store の
 * recomputeReviewAggregates の両方から呼ぶ。手書きの二重管理にしない)。
 */
export function countComments(files: ReviewFileChange[]): CommentCounts {
  let total = 0;
  let open = 0;
  let resolved = 0;
  let falsePositive = 0;
  for (const file of files) {
    for (const comment of file.comments ?? []) {
      total++;
      if (comment.disposition === "open") open++;
      else if (comment.disposition === "resolved") resolved++;
      else falsePositive++;
    }
  }
  return { total, open, resolved, falsePositive };
}
