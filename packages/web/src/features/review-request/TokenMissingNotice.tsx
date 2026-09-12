import { Button, InlineNotification } from "@carbon/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import styles from "./review-request.module.scss";

/** ST-01/RR-13/RR-14: PAT not configured — hide the selection area, show only the settings link. */
export function TokenMissingNotice() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className={styles.stack}>
      <InlineNotification
        kind="error"
        lowContrast
        hideCloseButton
        title={t("reviewRequest.tokenMissingTitle")}
        subtitle={t("reviewRequest.tokenMissingBody")}
      />
      <Button kind="secondary" onClick={() => navigate({ to: "/settings" })}>
        {t("reviewRequest.goToSettingsButton")}
      </Button>
    </div>
  );
}
