import { Button, InlineNotification, Loading } from "@carbon/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SettingsForm } from "./SettingsForm";
import styles from "./settings.module.scss";
import { fetchGithubSettings, persistHasGithubTokenFlag, SETTINGS_QUERY_KEY } from "./settingsApi";

/** SCR-04: loading/error states around the GET, then hands the result to SettingsForm. */
export function SettingsPage() {
  const { t } = useTranslation();
  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchGithubSettings,
  });

  // Self-heals SCR-01's PAT gate flag from the server's current state, in case
  // it was never written (fresh browser) or drifted from a prior session.
  useEffect(() => {
    if (settingsQuery.data) {
      persistHasGithubTokenFlag(settingsQuery.data.hasPersonalAccessToken);
    }
  }, [settingsQuery.data]);

  let body: ReactNode;
  if (settingsQuery.isPending) {
    body = (
      <div className={styles.loadingRow}>
        <Loading small withOverlay={false} description={t("settings.loading")} />
        <span>{t("settings.loading")}</span>
      </div>
    );
  } else if (settingsQuery.isError) {
    body = (
      <div className={styles.stack}>
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={t("settings.loadErrorTitle")}
          subtitle={t("settings.loadErrorBody")}
        />
        <Button kind="tertiary" onClick={() => settingsQuery.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  } else {
    body = <SettingsForm settings={settingsQuery.data} />;
  }

  return (
    <div className={styles.page}>
      <div>
        <h1>{t("settings.title")}</h1>
        <p>{t("settings.subtitle")}</p>
      </div>
      {body}
    </div>
  );
}
