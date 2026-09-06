import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/settings")({
  component: SettingsPlaceholder,
});

function SettingsPlaceholder() {
  const { t } = useTranslation();
  return <h1>{t("settings.title")}</h1>;
}
