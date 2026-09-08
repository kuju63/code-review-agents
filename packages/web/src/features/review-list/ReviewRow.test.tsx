import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReviewRow } from "./ReviewRow";
import type { Review } from "./reviews.schema";

function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "pr-482",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 482,
    title: "Fix login bug",
    branch: "fix/login",
    prState: "open",
    reviewStatus: "waiting",
    commentCounts: { total: 2, open: 1, resolved: 1, falsePositive: 0 },
    updatedAt: "2026-08-09T10:24:00+09:00",
    ...overrides,
  };
}

function buildRouter() {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <ReviewRow review={review()} onRequestClose={vi.fn()} />,
  });
  const reviewResultRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review-result",
    validateSearch: z.object({ id: z.string() }),
    component: () => {
      const { id } = reviewResultRoute.useSearch();
      return <p>review-result:{id}</p>;
    },
  });
  const routeTree = rootRoute.addChildren([indexRoute, reviewResultRoute]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) });
}

describe("ReviewRow (LST-12/LST-A07)", () => {
  it("links the PR title to /review-result carrying the reviewId as a search param", async () => {
    const router = buildRouter();
    render(<RouterProvider router={router} />);

    const link = await screen.findByRole("link", { name: "#482 Fix login bug" });
    expect(link.getAttribute("href")).toBe("/review-result?id=pr-482");

    fireEvent.click(link);

    expect(await screen.findByText("review-result:pr-482")).toBeInTheDocument();
  });
});
