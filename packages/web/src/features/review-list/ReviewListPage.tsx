import { Button, InlineNotification, Loading, Modal } from "@carbon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterBar } from "./FilterBar";
import { RepoGroup } from "./RepoGroup";
import styles from "./review-list.module.scss";
import type { Review } from "./reviews.schema";
import { closeReview, fetchReviews } from "./reviewsApi";
import { TokenMissingNotice } from "./TokenMissingNotice";
import { useReviewListState } from "./useReviewListState";

const REVIEWS_QUERY_KEY = ["reviews"] as const;

type ActionNotice = { kind: "conflict" } | { kind: "stale" } | { kind: "error" };

export interface ReviewListPageProps {
  /** ST-06/LST-04: `org/repo #N` carried over from SCR-02 on successful submission. */
  submittedTarget?: string;
}

function hasGithubToken(): boolean {
  try {
    return localStorage.getItem("hasGithubToken") === "true";
  } catch {
    return false;
  }
}

/** SCR-01: PAT gate, loading/error/empty states, filtering, and the close flow. */
export function ReviewListPage({ submittedTarget }: ReviewListPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tokenMissing] = useState(() => !hasGithubToken());
  const [submittedDismissed, setSubmittedDismissed] = useState(false);
  const [closeTarget, setCloseTarget] = useState<Review | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);

  const reviewsQuery = useQuery({
    queryKey: REVIEWS_QUERY_KEY,
    queryFn: fetchReviews,
    enabled: !tokenMissing,
  });

  const listState = useReviewListState(reviewsQuery.data?.items ?? []);

  const closeMutation = useMutation({
    mutationFn: closeReview,
    onSuccess: (result) => {
      setCloseTarget(null);
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: REVIEWS_QUERY_KEY });
        return;
      }
      if (result.code === "conflict") {
        setActionNotice({ kind: "conflict" });
        return;
      }
      // not_found (LST-V05): the row we tried to close is already stale.
      setActionNotice({ kind: "stale" });
      void queryClient.invalidateQueries({ queryKey: REVIEWS_QUERY_KEY });
    },
    onError: () => {
      setCloseTarget(null);
      setActionNotice({ kind: "error" });
    },
  });

  let body: ReactNode;
  if (tokenMissing) {
    body = <TokenMissingNotice />;
  } else if (reviewsQuery.isPending) {
    body = (
      <div className={styles.loadingRow}>
        <Loading small withOverlay={false} description={t("reviewList.loading")} />
        <span>{t("reviewList.loading")}</span>
      </div>
    );
  } else if (reviewsQuery.isError) {
    body = (
      <div className={styles.stack}>
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={t("reviewList.loadErrorTitle")}
          subtitle={t("reviewList.loadErrorBody")}
        />
        <Button kind="tertiary" onClick={() => reviewsQuery.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  } else if (listState.groups.length === 0) {
    body = <div className={styles.noResults}>{t("reviewList.noResults")}</div>;
  } else {
    body = listState.groups.map((group) => (
      <RepoGroup
        key={group.repoKey}
        repoKey={group.repoKey}
        reviews={group.reviews}
        collapsed={listState.isRepoCollapsed(group.repoKey)}
        onToggle={() => listState.toggleRepoCollapsed(group.repoKey)}
        onRequestClose={setCloseTarget}
      />
    ));
  }

  return (
    <div className={styles.page}>
      <div className={styles.headRow}>
        <div>
          <h1>{t("reviewList.title")}</h1>
          <p>{t("reviewList.subtitle")}</p>
        </div>
        {!tokenMissing && (
          <Button onClick={() => navigate({ to: "/review-request" })}>
            {t("reviewList.newReviewButton")}
          </Button>
        )}
      </div>

      {!tokenMissing && submittedTarget && !submittedDismissed && (
        <InlineNotification
          kind="success"
          title={t("reviewList.submittedNoticeTitle")}
          subtitle={t("reviewList.submittedNoticeBody", { target: submittedTarget })}
          aria-label={t("common.close")}
          onCloseButtonClick={() => setSubmittedDismissed(true)}
        />
      )}

      {actionNotice && (
        <InlineNotification
          kind={actionNotice.kind === "error" ? "error" : "warning"}
          title={t(
            actionNotice.kind === "conflict"
              ? "reviewList.closeConflictNotice"
              : actionNotice.kind === "stale"
                ? "reviewList.closeStaleNotice"
                : "reviewList.closeGenericErrorNotice",
          )}
          aria-label={t("common.close")}
          onCloseButtonClick={() => setActionNotice(null)}
        />
      )}

      {!tokenMissing && !reviewsQuery.isPending && !reviewsQuery.isError && (
        <FilterBar
          repoOptions={listState.repoOptions}
          filterRepo={listState.filterRepo}
          onFilterRepoChange={listState.setFilterRepo}
          filterStatus={listState.filterStatus}
          onFilterStatusChange={listState.setFilterStatus}
          searchQuery={listState.searchQuery}
          onSearchQueryChange={listState.setSearchQuery}
        />
      )}

      {body}

      <Modal
        open={closeTarget !== null}
        modalHeading={t("reviewList.closeConfirmTitle")}
        primaryButtonText={t("common.confirm")}
        secondaryButtonText={t("common.cancel")}
        danger
        onRequestClose={() => setCloseTarget(null)}
        onRequestSubmit={() => {
          if (closeTarget) closeMutation.mutate(closeTarget.reviewId);
        }}
      >
        <p>{t("reviewList.closeConfirmBody")}</p>
      </Modal>
    </div>
  );
}
