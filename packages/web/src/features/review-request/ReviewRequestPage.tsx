import {
  Button,
  Link as CarbonLink,
  Dropdown,
  InlineNotification,
  Loading,
  ProgressIndicator,
  ProgressStep,
} from "@carbon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { PullRequestCard } from "./PullRequestCard";
import styles from "./review-request.module.scss";
import type { GithubOrg, GithubRepository } from "./reviewRequest.schema";
import {
  fetchGithubOrgs,
  fetchGithubPullRequests,
  fetchGithubRepositories,
  GithubUnauthorizedError,
  submitReviewRequest,
} from "./reviewRequestApi";
import { TokenMissingNotice } from "./TokenMissingNotice";
import { useReviewRequestSelection } from "./useReviewRequestSelection";

const REVIEWS_QUERY_KEY = ["reviews"] as const;

function hasGithubToken(): boolean {
  try {
    return localStorage.getItem("hasGithubToken") === "true";
  } catch {
    return false;
  }
}

type SubmitNotice = { kind: "conflict"; message: string } | { kind: "error" };

/** SCR-02: PAT gate, org→repo→PR cascade selection, and the submit/cancel flow (ST-01〜ST-06). */
export function ReviewRequestPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tokenMissing] = useState(() => !hasGithubToken());
  const selection = useReviewRequestSelection();
  const [submitNotice, setSubmitNotice] = useState<SubmitNotice | null>(null);

  const orgsQuery = useQuery({
    queryKey: ["review-request", "orgs"],
    queryFn: fetchGithubOrgs,
    enabled: !tokenMissing,
  });

  const reposQuery = useQuery({
    queryKey: ["review-request", "repos", selection.organization],
    queryFn: () => fetchGithubRepositories(selection.organization ?? ""),
    enabled: !tokenMissing && selection.organization !== null,
  });

  const prsQuery = useQuery({
    queryKey: ["review-request", "prs", selection.organization, selection.repository],
    queryFn: () =>
      fetchGithubPullRequests(selection.organization ?? "", selection.repository ?? ""),
    enabled: !tokenMissing && selection.organization !== null && selection.repository !== null,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      submitReviewRequest(
        {
          organization: selection.organization ?? "",
          repository: selection.repository ?? "",
          pullRequest: selection.pullRequest ?? 0,
        },
        selection.idempotencyKey,
      ),
    onSuccess: (result) => {
      if (result.ok) {
        setSubmitNotice(null);
        void queryClient.invalidateQueries({ queryKey: REVIEWS_QUERY_KEY });
        navigate({
          to: "/",
          search: {
            submitted: `${result.data.organization}/${result.data.repository} #${result.data.pullRequest}`,
          },
        });
        return;
      }
      if (result.code === "conflict") {
        setSubmitNotice({ kind: "conflict", message: result.message });
        return;
      }
      setSubmitNotice({ kind: "error" });
    },
    onError: () => setSubmitNotice({ kind: "error" }),
  });

  const unauthorized =
    orgsQuery.error instanceof GithubUnauthorizedError ||
    reposQuery.error instanceof GithubUnauthorizedError ||
    prsQuery.error instanceof GithubUnauthorizedError;

  let body: ReactNode;
  if (tokenMissing) {
    body = <TokenMissingNotice />;
  } else if (unauthorized) {
    body = (
      <div className={styles.stack}>
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={t("reviewRequest.unauthorizedTitle")}
          subtitle={t("reviewRequest.unauthorizedBody")}
        />
        <Button kind="secondary" onClick={() => navigate({ to: "/settings" })}>
          {t("reviewRequest.goToSettingsButton")}
        </Button>
      </div>
    );
  } else if (orgsQuery.isPending) {
    body = (
      <div className={styles.loadingRow}>
        <Loading small withOverlay={false} description={t("common.retry")} />
      </div>
    );
  } else if (orgsQuery.isError) {
    body = (
      <div className={styles.stack}>
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={t("reviewRequest.orgsLoadErrorTitle")}
          subtitle={t("reviewRequest.orgsLoadErrorBody")}
        />
        <Button kind="tertiary" onClick={() => orgsQuery.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  } else {
    const orgs: GithubOrg[] = orgsQuery.data ?? [];
    const repos: GithubRepository[] = reposQuery.data ?? [];
    const selectedOrg = orgs.find((org) => org.name === selection.organization);
    const selectedRepo = repos.find((repo) => repo.name === selection.repository);

    body = (
      <>
        <ProgressIndicator currentIndex={selection.step}>
          <ProgressStep label={t("reviewRequest.progressStep1")} />
          <ProgressStep label={t("reviewRequest.progressStep2")} />
          <ProgressStep label={t("reviewRequest.progressStep3")} />
        </ProgressIndicator>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <Dropdown<GithubOrg>
              id="review-request-org"
              titleText={t("reviewRequest.orgLabel")}
              label={t("reviewRequest.orgPlaceholder")}
              items={orgs}
              itemToString={(item) => item?.name ?? ""}
              selectedItem={selectedOrg}
              onChange={({ selectedItem }) => {
                if (selectedItem) selection.selectOrganization(selectedItem.name);
              }}
            />
          </div>
          <div className={styles.field}>
            <Dropdown<GithubRepository>
              id="review-request-repo"
              titleText={t("reviewRequest.repoLabel")}
              label={
                selection.organization
                  ? t("reviewRequest.repoPlaceholder")
                  : t("reviewRequest.repoPlaceholderDisabled")
              }
              items={repos}
              itemToString={(item) => item?.name ?? ""}
              selectedItem={selectedRepo}
              disabled={selection.organization === null}
              onChange={({ selectedItem }) => {
                if (selectedItem) selection.selectRepository(selectedItem.name);
              }}
            />
          </div>
        </div>

        {reposQuery.isError && (
          <div className={styles.stack}>
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title={t("reviewRequest.reposLoadErrorTitle")}
              subtitle={t("reviewRequest.reposLoadErrorBody")}
            />
            <Button kind="tertiary" onClick={() => reposQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}

        {selection.repository !== null && (
          <div className={styles.prList}>
            <div className={styles.prListHeading}>{t("reviewRequest.prListHeading")}</div>
            {prsQuery.isPending ? (
              <div className={styles.loadingRow}>
                <Loading small withOverlay={false} description={t("common.retry")} />
              </div>
            ) : prsQuery.isError ? (
              <div className={styles.stack}>
                <InlineNotification
                  kind="error"
                  lowContrast
                  hideCloseButton
                  title={t("reviewRequest.prsLoadErrorTitle")}
                  subtitle={t("reviewRequest.prsLoadErrorBody")}
                />
                <Button kind="tertiary" onClick={() => prsQuery.refetch()}>
                  {t("common.retry")}
                </Button>
              </div>
            ) : (prsQuery.data ?? []).length === 0 ? (
              <div className={styles.noResults}>{t("reviewRequest.prNoResults")}</div>
            ) : (
              <div className={styles.prCards}>
                {(prsQuery.data ?? []).map((pr) => (
                  <PullRequestCard
                    key={pr.number}
                    pullRequest={pr}
                    selected={selection.pullRequest === pr.number}
                    onSelect={selection.selectPullRequest}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {selection.organization !== null &&
          selection.repository !== null &&
          selection.pullRequest !== null && (
            <div className={styles.summaryPanel}>
              <div className={styles.summaryHeading}>{t("reviewRequest.summaryHeading")}</div>
              <pre className={styles.summaryList}>
                {t("reviewRequest.summaryOrganizationLabel")}: {selection.organization}
                {"\n"}
                {t("reviewRequest.summaryRepositoryLabel")}: {selection.repository}
                {"\n"}
                {t("reviewRequest.summaryPullRequestLabel")}: {selection.pullRequest}
              </pre>

              {submitNotice?.kind === "conflict" && (
                <InlineNotification
                  kind="warning"
                  lowContrast
                  hideCloseButton
                  title={t("reviewRequest.submitConflictTitle")}
                  subtitle={t("reviewRequest.submitConflictBody")}
                />
              )}
              {submitNotice?.kind === "error" && (
                <InlineNotification
                  kind="error"
                  lowContrast
                  hideCloseButton
                  title={t("reviewRequest.submitErrorTitle")}
                  subtitle={t("reviewRequest.submitErrorBody")}
                />
              )}
              {submitNotice?.kind === "conflict" && (
                <CarbonLink onClick={() => navigate({ to: "/" })}>
                  {t("reviewRequest.goToListButton")}
                </CarbonLink>
              )}

              <div className={styles.actionsRow}>
                <Button disabled={submitMutation.isPending} onClick={() => submitMutation.mutate()}>
                  {submitMutation.isPending
                    ? t("reviewRequest.submitting")
                    : t("reviewRequest.submitButton")}
                </Button>
                <Link to="/">{t("reviewRequest.cancelLink")}</Link>
              </div>
            </div>
          )}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <div>
        <h1>{t("reviewRequest.title")}</h1>
        <p>{t("reviewRequest.subtitle")}</p>
      </div>
      {body}
    </div>
  );
}
