import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute({ component: AppShell });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>list-content</p>,
  });
  const reviewRequestRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review-request",
    component: () => <p>review-request-content</p>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <p>settings-content</p>,
  });
  const reviewResultRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review-result",
    component: () => <p>review-result-content</p>,
  });
  const routeTree = rootRoute.addChildren([
    indexRoute,
    reviewRequestRoute,
    settingsRoute,
    reviewResultRoute,
  ]);
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  return createRouter({ routeTree, history });
}

function renderShell(initialPath = "/") {
  const router = buildRouter(initialPath);
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  localStorage.clear();
});

describe("AppShell", () => {
  it("renders the brand, sidebar nav, breadcrumb, and the matched route's content", async () => {
    renderShell("/");

    expect(await screen.findByText("PR Review Agent")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "コードレビュー一覧" })).toBeInTheDocument();
    expect(screen.getByText("list-content")).toBeInTheDocument();
  });

  it("navigates via the sidebar link and updates the breadcrumb (COM-04/06)", async () => {
    renderShell("/");
    await screen.findByText("list-content");

    fireEvent.click(screen.getByRole("link", { name: /レビュー依頼登録/ }));

    expect(await screen.findByText("review-request-content")).toBeInTheDocument();
  });

  it("toggles sidebar label visibility while preserving the link's accessible name and persists it (COM-05)", async () => {
    renderShell("/");
    await screen.findByText("list-content");
    expect(
      within(screen.getByRole("link", { name: "設定" })).getByText("設定"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "サイドバーを折りたたむ" }));

    const settingsLink = screen.getByRole("link", { name: "設定" });
    expect(settingsLink).toBeInTheDocument();
    expect(within(settingsLink).queryByText("設定")).not.toBeInTheDocument();
    expect(localStorage.getItem("sidebarCollapsed")).toBe("true");
  });

  it("shows the review-result breadcrumb label instead of falling back to the list label", async () => {
    renderShell("/review-result");
    await screen.findByText("review-result-content");

    const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(breadcrumb.getByText("レビュー結果確認")).toBeInTheDocument();
    expect(breadcrumb.queryByText("コードレビュー一覧")).not.toBeInTheDocument();
  });
});
