import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
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
  const routeTree = rootRoute.addChildren([indexRoute, reviewRequestRoute, settingsRoute]);
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

  it("toggles sidebar label visibility and persists it (COM-05)", async () => {
    renderShell("/");
    await screen.findByText("list-content");
    expect(screen.getByRole("link", { name: /設定/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "サイドバーを折りたたむ" }));

    expect(screen.queryByRole("link", { name: /^設定$/ })).not.toBeInTheDocument();
    expect(localStorage.getItem("sidebarCollapsed")).toBe("true");
  });
});
