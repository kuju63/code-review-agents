import { Button, Tag } from "@carbon/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import styles from "./review-list.module.scss";
import {
  formatPrTitle,
  formatUpdatedAt,
  resolveCommentSummary,
  resolvePrStateTag,
  resolveStatusTag,
  shouldShowCloseButton,
} from "./reviewStatus";
import type { Review } from "./reviews.schema";

export interface ReviewRowProps {
  review: Review;
  onRequestClose: (review: Review) => void;
}

/** 明細行1件分 (LST-12..LST-18)。 */
export function ReviewRow({ review, onRequestClose }: ReviewRowProps) {
  const { t } = useTranslation();
  const statusTag = resolveStatusTag(review.reviewStatus);
  const prStateTag = resolvePrStateTag(review.prState);
  const commentSummary = resolveCommentSummary(review);

  return (
    <div className={styles.row}>
      <span>
        <Link to="/review-result" search={{ id: review.reviewId }}>
          {formatPrTitle(review)}
        </Link>
      </span>
      <span className={styles.branchCell}>{review.branch ?? "—"}</span>
      <span>
        <Tag type={statusTag.type} size="sm">
          {t(statusTag.labelKey)}
        </Tag>
      </span>
      <span>
        <Tag type={prStateTag.type} size="sm">
          {t(prStateTag.labelKey)}
        </Tag>
      </span>
      <span className={styles.mutedCell}>
        {commentSummary.kind === "error"
          ? t("reviewList.status.error")
          : commentSummary.kind === "none"
            ? t("reviewList.commentsNone")
            : t("reviewList.commentsCount", { count: commentSummary.count })}
      </span>
      <span className={styles.mutedCell}>{formatUpdatedAt(review.updatedAt)}</span>
      <span>
        {shouldShowCloseButton(review) && (
          <Button kind="ghost" size="sm" onClick={() => onRequestClose(review)}>
            {t("reviewList.closeButton")}
          </Button>
        )}
      </span>
    </div>
  );
}
