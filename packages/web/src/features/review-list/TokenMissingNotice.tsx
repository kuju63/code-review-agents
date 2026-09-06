import { Button, InlineNotification } from "@carbon/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import styles from "./review-list.module.scss";

/** ST-01/CB-04: PAT not configured — hide everything except the settings link. */
export function TokenMissingNotice() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className={styles.stack}>
      <InlineNotification
        kind="error"
        lowContrast
        hideCloseButton
        title={t("reviewList.tokenMissingTitle")}
        subtitle={t("reviewList.tokenMissingBody")}
      />
      <Button kind="secondary" onClick={() => navigate({ to: "/settings" })}>
        {t("reviewList.goToSettingsButton")}
      </Button>
    </div>
  );
}
