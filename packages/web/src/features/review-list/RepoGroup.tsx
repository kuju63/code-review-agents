import { ChevronDown, ChevronRight } from "@carbon/react/icons";
import { useTranslation } from "react-i18next";
import { ReviewRow } from "./ReviewRow";
import styles from "./review-list.module.scss";
import type { Review } from "./reviews.schema";

export interface RepoGroupProps {
  repoKey: string;
  reviews: Review[];
  collapsed: boolean;
  onToggle: () => void;
  onRequestClose: (review: Review) => void;
}

/** LST-10/LST-11/LST-A06: repository heading, collapse state, and its member rows. */
export function RepoGroup({
  repoKey,
  reviews,
  collapsed,
  onToggle,
  onRequestClose,
}: RepoGroupProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.repoGroup}>
      <button
        type="button"
        className={styles.repoGroupHeader}
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
        <span>{repoKey}</span>
        <span className={styles.repoCount}>
          {t("reviewList.repoGroupCount", { count: reviews.length })}
        </span>
      </button>
      {!collapsed && (
        <>
          <div className={styles.tableHead}>
            <span>{t("reviewList.columnPR")}</span>
            <span>{t("reviewList.columnBranch")}</span>
            <span>{t("reviewList.columnReviewStatus")}</span>
            <span>{t("reviewList.columnPRStatus")}</span>
            <span>{t("reviewList.columnComments")}</span>
            <span>{t("reviewList.columnUpdatedAt")}</span>
            <span>{t("reviewList.columnActions")}</span>
          </div>
          {reviews.map((review) => (
            <ReviewRow key={review.reviewId} review={review} onRequestClose={onRequestClose} />
          ))}
        </>
      )}
    </div>
  );
}
