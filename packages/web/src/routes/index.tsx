import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ReviewListPage } from "../features/review-list/ReviewListPage";

const indexSearchSchema = z.object({ submitted: z.string().optional() });

export const Route = createFileRoute("/")({
  validateSearch: indexSearchSchema,
  component: Index,
});

function Index() {
  const { submitted } = Route.useSearch();
  return <ReviewListPage submittedTarget={submitted} />;
}
