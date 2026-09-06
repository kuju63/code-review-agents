import { useCallback, useMemo, useState } from "react";
import { matchesSearch } from "./reviewStatus";
import type { Review, ReviewStatus } from "./reviews.schema";

export const ALL_FILTER = "__all__";

export type StatusFilter = ReviewStatus | typeof ALL_FILTER;

export interface RepoGroup {
  repoKey: string;
  reviews: Review[];
}

export interface UseReviewListState {
  filterRepo: string;
  setFilterRepo: (value: string) => void;
  filterStatus: StatusFilter;
  setFilterStatus: (value: StatusFilter) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  isRepoCollapsed: (repoKey: string) => boolean;
  toggleRepoCollapsed: (repoKey: string) => void;
  repoOptions: string[];
  groups: RepoGroup[];
}

const STORAGE_KEYS = {
  filterRepo: "reviewList.filterRepo",
  filterStatus: "reviewList.filterStatus",
  searchQuery: "reviewList.searchQuery",
  collapsedRepos: "reviewList.collapsedRepos",
} as const;

const VALID_STATUS_FILTERS = new Set<StatusFilter>([
  ALL_FILTER,
  "not_started",
  "analyzing",
  "waiting",
  "completed",
  "error",
]);

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode/disabled storage: filters just won't persist across visits.
  }
}

function readCollapsedRepos(): Record<string, boolean> {
  const raw = readString(STORAGE_KEYS.collapsedRepos);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

function repoKeyOf(review: Pick<Review, "organization" | "repository">): string {
  return `${review.organization}/${review.repository}`;
}

/**
 * LST-A02/A03/A04/A05/A06: repo/status/search filtering (AND-combined) and
 * repo-group collapse state, persisted per browser. `reviews` is expected to
 * already be the fully-loaded, non-closed list (fetchReviews' perPage=100
 * result) — this hook does no fetching of its own.
 */
export function useReviewListState(reviews: Review[]): UseReviewListState {
  const repoOptions = useMemo(() => {
    const seen: string[] = [];
    for (const review of reviews) {
      const key = repoKeyOf(review);
      if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }, [reviews]);

  const [rawFilterRepo, setRawFilterRepo] = useState<string>(
    () => readString(STORAGE_KEYS.filterRepo) ?? ALL_FILTER,
  );
  const [filterStatus, setFilterStatusState] = useState<StatusFilter>(() => {
    const saved = readString(STORAGE_KEYS.filterStatus);
    return saved && VALID_STATUS_FILTERS.has(saved as StatusFilter)
      ? (saved as StatusFilter)
      : ALL_FILTER;
  });
  const [searchQuery, setSearchQueryState] = useState<string>(
    () => readString(STORAGE_KEYS.searchQuery) ?? "",
  );
  const [collapsedRepos, setCollapsedRepos] = useState<Record<string, boolean>>(readCollapsedRepos);

  // LST-V02: a persisted repo that no longer appears among the current
  // options reverts to "all" — computed on read rather than written back, so
  // it re-validates correctly if the same repo reappears later.
  const filterRepo =
    rawFilterRepo === ALL_FILTER || repoOptions.includes(rawFilterRepo)
      ? rawFilterRepo
      : ALL_FILTER;

  const setFilterRepo = useCallback((value: string) => {
    setRawFilterRepo(value);
    writeString(STORAGE_KEYS.filterRepo, value);
  }, []);

  const setFilterStatus = useCallback((value: StatusFilter) => {
    setFilterStatusState(value);
    writeString(STORAGE_KEYS.filterStatus, value);
  }, []);

  const setSearchQuery = useCallback((value: string) => {
    setSearchQueryState(value);
    writeString(STORAGE_KEYS.searchQuery, value);
  }, []);

  const toggleRepoCollapsed = useCallback((repoKey: string) => {
    setCollapsedRepos((prev) => {
      const next = { ...prev, [repoKey]: !prev[repoKey] };
      try {
        localStorage.setItem(STORAGE_KEYS.collapsedRepos, JSON.stringify(next));
      } catch {
        // Private-mode/disabled storage: collapse state just won't persist.
      }
      return next;
    });
  }, []);

  const isRepoCollapsed = useCallback(
    (repoKey: string) => Boolean(collapsedRepos[repoKey]),
    [collapsedRepos],
  );

  const groups = useMemo<RepoGroup[]>(() => {
    const byRepo = new Map<string, Review[]>();
    for (const review of reviews) {
      const key = repoKeyOf(review);
      if (filterRepo !== ALL_FILTER && filterRepo !== key) continue;
      if (filterStatus !== ALL_FILTER && review.reviewStatus !== filterStatus) continue;
      if (!matchesSearch(review, searchQuery)) continue;
      const bucket = byRepo.get(key);
      if (bucket) bucket.push(review);
      else byRepo.set(key, [review]);
    }
    return repoOptions
      .filter((key) => byRepo.has(key))
      .map((key) => ({ repoKey: key, reviews: byRepo.get(key) ?? [] }));
  }, [reviews, filterRepo, filterStatus, searchQuery, repoOptions]);

  return {
    filterRepo,
    setFilterRepo,
    filterStatus,
    setFilterStatus,
    searchQuery,
    setSearchQuery,
    isRepoCollapsed,
    toggleRepoCollapsed,
    repoOptions,
    groups,
  };
}
