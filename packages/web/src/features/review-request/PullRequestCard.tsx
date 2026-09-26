import { Tag } from "@carbon/react";
import { useTranslation } from "react-i18next";
import styles from "./review-request.module.scss";
import type { GithubPullRequest } from "./reviewRequest.schema";

export interface PullRequestCardProps {
  pullRequest: GithubPullRequest;
  selected: boolean;
  onSelect: (pullRequest: number) => void;
}

/**
 * RR-07: 単一PRカード。`aria-pressed`で選択状態を支援技術へ伝える(OP-03)。
 * `/github/prs`は`state=open`固定で取得するため、PR状態タグは常にOpenを表示する。
 */
export function PullRequestCard({ pullRequest, selected, onSelect }: PullRequestCardProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={selected ? `${styles.prCard} ${styles.prCardSelected}` : styles.prCard}
      aria-pressed={selected}
      onClick={() => onSelect(pullRequest.number)}
    >
      <span className={styles.prCardMain}>
        <span className={styles.prCardTitle}>
          #{pullRequest.number} {pullRequest.title}
        </span>
        <span className={styles.prCardMeta}>
          {t("reviewRequest.prMetaFormat", {
            baseBranch: pullRequest.baseBranch,
            author: pullRequest.author,
          })}
        </span>
      </span>
      <Tag type="green" size="sm">
        {t("reviewList.prState.open")}
      </Tag>
    </button>
  );
}
