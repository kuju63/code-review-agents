import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";

const reviewResultSearchSchema = z.object({ id: z.string() });

export const Route = createFileRoute("/review-result")({
  validateSearch: reviewResultSearchSchema,
  component: ReviewResultPlaceholder,
});

/** LST-12/LST-A07 navigate here; SCR-03's full implementation is a separate task. */
function ReviewResultPlaceholder() {
  const { t } = useTranslation();
  const { id } = Route.useSearch();
  return (
    <div>
      <h1>{t("reviewResult.title")}</h1>
      <p>{id}</p>
    </div>
  );
}
