import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setApiFetchHandler } from "../../test/setup";
import { ReviewListPage } from "./ReviewListPage";
import type { Review, ReviewListResponse } from "./reviews.schema";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "pr-1",
    organization: "acme-corp",
    repository: "web-frontend",
    pullRequest: 1,
    title: "Fix login bug",
    branch: "fix/login",
    prState: "open",
    reviewStatus: "not_started",
    commentCounts: { total: 0, open: 0, resolved: 0, falsePositive: 0 },
    updatedAt: "2026-08-09T10:24:00+09:00",
    ...overrides,
  };
}

function listResponse(items: Review[]): ReviewListResponse {
  return {
    apiVersion: "1.0.0",
    items,
    pageInfo: { page: 1, perPage: 100, totalItems: items.length, totalPages: 1 },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPage(props: { submittedTarget?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReviewListPage {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("ReviewListPage", () => {
  it("ST-01: shows the token-missing notice and no fetch when PAT isn't configured", async () => {
    renderPage();

    expect(await screen.findByText("GitHubアクセストークンが未設定です。")).toBeInTheDocument();
    expect(screen.queryByText("+ レビュー依頼を登録")).not.toBeInTheDocument();
  });

  it("ST-02→ST-04: shows a loading indicator, then renders the fetched, grouped reviews", async () => {
    localStorage.setItem("hasGithubToken", "true");
    let resolveFetch: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    setApiFetchHandler(vi.fn().mockReturnValue(pending));

    renderPage();

    expect((await screen.findAllByText("読み込み中です…")).length).toBeGreaterThan(0);

    resolveFetch(jsonResponse(listResponse([review()])));

    expect(await screen.findByText("#1 Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("acme-corp/web-frontend")).toBeInTheDocument();
  });

  it("ST-03: shows a retry affordance on fetch failure and reloads on click", async () => {
    localStorage.setItem("hasGithubToken", "true");
    const handler = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(listResponse([review()])));
    setApiFetchHandler(handler);

    renderPage();

    const retryButton = await screen.findByRole("button", { name: "再試行" });
    fireEvent.click(retryButton);

    expect(await screen.findByText("#1 Fix login bug")).toBeInTheDocument();
  });

  it("ST-05: shows the no-results message once combined filters exclude everything", async () => {
    localStorage.setItem("hasGithubToken", "true");
    localStorage.setItem("reviewList.filterStatus", "error");
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse(listResponse([review()]))));

    renderPage();

    expect(await screen.findByText("条件に一致するPRがありません。")).toBeInTheDocument();
  });

  it("ST-06: shows and dismisses the submitted-request notice", async () => {
    localStorage.setItem("hasGithubToken", "true");
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse(listResponse([review()]))));

    renderPage({ submittedTarget: "acme-corp/web-frontend #9" });

    expect(
      await screen.findByText(
        "acme-corp/web-frontend #9 の依頼を受け付けました。エージェントがレビューを開始します。",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(
      screen.queryByText(
        "acme-corp/web-frontend #9 の依頼を受け付けました。エージェントがレビューを開始します。",
      ),
    ).not.toBeInTheDocument();
  });

  it("LST-A08: closes a review via the confirm modal and removes it from the list", async () => {
    localStorage.setItem("hasGithubToken", "true");
    let reviews = [review({ reviewStatus: "completed" })];
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/reviews/pr-1/close") && init?.method === "POST") {
          reviews = [];
          return jsonResponse(review({ reviewStatus: "completed", prState: "open" }));
        }
        return jsonResponse(listResponse(reviews));
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "クローズ" }));
    fireEvent.click(await screen.findByRole("button", { name: "実行" }));

    expect(await screen.findByText("条件に一致するPRがありません。")).toBeInTheDocument();
  });

  it("shows a conflict notice and keeps the row when close returns 409", async () => {
    localStorage.setItem("hasGithubToken", "true");
    const reviews = [review({ reviewStatus: "completed" })];
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/reviews/pr-1/close") && init?.method === "POST") {
          return jsonResponse({}, 409);
        }
        return jsonResponse(listResponse(reviews));
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "クローズ" }));
    fireEvent.click(await screen.findByRole("button", { name: "実行" }));

    expect(
      await screen.findByText("未対応のコメントが残っているためクローズできません。"),
    ).toBeInTheDocument();
    expect(screen.getByText("#1 Fix login bug")).toBeInTheDocument();
  });
});
