import { Dropdown, Search } from "@carbon/react";
import { useTranslation } from "react-i18next";
import styles from "./review-list.module.scss";
import { ALL_FILTER, type StatusFilter } from "./useReviewListState";

const STATUS_FILTER_OPTIONS: StatusFilter[] = [
  ALL_FILTER,
  "not_started",
  "analyzing",
  "waiting",
  "completed",
  "error",
];

export interface FilterBarProps {
  repoOptions: string[];
  filterRepo: string;
  onFilterRepoChange: (value: string) => void;
  filterStatus: StatusFilter;
  onFilterStatusChange: (value: StatusFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
}

/** LST-07/08/09: repo/status dropdowns and free-text search, all AND-combined by the caller. */
export function FilterBar({
  repoOptions,
  filterRepo,
  onFilterRepoChange,
  filterStatus,
  onFilterStatusChange,
  searchQuery,
  onSearchQueryChange,
}: FilterBarProps) {
  const { t } = useTranslation();
  const repoItems = [ALL_FILTER, ...repoOptions];

  return (
    <div className={styles.filterRow}>
      <div className={styles.filterField}>
        <Dropdown<string>
          id="review-list-filter-repo"
          titleText={t("reviewList.filterRepoLabel")}
          label={t("reviewList.filterAll")}
          items={repoItems}
          itemToString={(item) =>
            item === ALL_FILTER || item == null ? t("reviewList.filterAll") : item
          }
          selectedItem={filterRepo}
          onChange={({ selectedItem }) => onFilterRepoChange(selectedItem ?? ALL_FILTER)}
        />
      </div>
      <div className={styles.filterField}>
        <Dropdown<StatusFilter>
          id="review-list-filter-status"
          titleText={t("reviewList.filterStatusLabel")}
          label={t("reviewList.filterAll")}
          items={STATUS_FILTER_OPTIONS}
          itemToString={(item) =>
            item == null || item === ALL_FILTER
              ? t("reviewList.filterAll")
              : t(`reviewList.status.${item}`)
          }
          selectedItem={filterStatus}
          onChange={({ selectedItem }) => onFilterStatusChange(selectedItem ?? ALL_FILTER)}
        />
      </div>
      <div className={styles.filterField}>
        <Search
          id="review-list-search"
          labelText={t("reviewList.searchLabel")}
          placeholder={t("reviewList.searchPlaceholder")}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </div>
    </div>
  );
}
