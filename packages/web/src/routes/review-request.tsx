import { createFileRoute } from "@tanstack/react-router";
import { ReviewRequestPage } from "../features/review-request/ReviewRequestPage";

export const Route = createFileRoute("/review-request")({
  component: ReviewRequestPage,
});
