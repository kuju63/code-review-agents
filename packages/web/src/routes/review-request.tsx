import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/review-request")({
  component: ReviewRequestPlaceholder,
});

function ReviewRequestPlaceholder() {
  const { t } = useTranslation();
  return <h1>{t("reviewRequest.title")}</h1>;
}
