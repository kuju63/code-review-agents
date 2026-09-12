import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setApiFetchHandler } from "../../test/setup";
import { ReviewRequestPage } from "./ReviewRequestPage";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function orgsResponse(names: string[] = ["acme-corp"]) {
  return {
    apiVersion: "1.0.0",
    items: names.map((name, index) => ({ name, id: index + 1 })),
  };
}

function reposResponse(names: string[] = ["web-frontend"]) {
  return {
    apiVersion: "1.0.0",
    items: names.map((name, index) => ({
      name,
      id: index + 1,
      defaultBranch: "main",
      openIssuesCount: 0,
    })),
  };
}

function prsResponse(
  prs: Array<{ number: number; title: string }> = [{ number: 482, title: "Fix login bug" }],
) {
  return {
    apiVersion: "1.0.0",
    items: prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: "open",
      createdAt: "2026-08-09T10:24:00Z",
      author: "octocat",
      baseBranch: "main",
    })),
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReviewRequestPage />
    </QueryClientProvider>,
  );
}

function defaultHandler() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/github/orgs")) return jsonResponse(orgsResponse());
    if (url.includes("/github/repos")) return jsonResponse(reposResponse());
    if (url.includes("/github/prs")) return jsonResponse(prsResponse());
    throw new Error(`unexpected request: ${url}`);
  });
}

beforeEach(() => {
  localStorage.clear();
  navigateMock.mockClear();
});

describe("ReviewRequestPage", () => {
  it("ST-01: shows the token-missing notice when PAT isn't configured", async () => {
    renderPage();

    expect(await screen.findByText("GitHubアクセストークンが未設定です。")).toBeInTheDocument();
  });

  it("shows a distinct notice when /github/orgs returns 401 (invalid/expired PAT)", async () => {
    localStorage.setItem("hasGithubToken", "true");
    setApiFetchHandler(
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { apiVersion: "1.0.0", code: "unauthorized", message: "x", detail: null },
            401,
          ),
        ),
    );

    renderPage();

    expect(await screen.findByText("GitHubへの認証に失敗しました。")).toBeInTheDocument();
    expect(screen.queryByText("GitHubアクセストークンが未設定です。")).not.toBeInTheDocument();
  });

  it("ST-02→ST-04: selecting an org loads its repos, selecting a repo loads its open PRs", async () => {
    localStorage.setItem("hasGithubToken", "true");
    setApiFetchHandler(defaultHandler());

    renderPage();

    fireEvent.click(await screen.findByRole("combobox", { name: "Organization / ユーザー" }));
    fireEvent.click(await screen.findByText("acme-corp"));

    fireEvent.click(await screen.findByRole("combobox", { name: "リポジトリ" }));
    fireEvent.click(await screen.findByText("web-frontend"));

    expect(await screen.findByText("#482 Fix login bug")).toBeInTheDocument();
  });

  it("RR-08: shows the no-PR message when the repo has no open PRs", async () => {
    localStorage.setItem("hasGithubToken", "true");
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/github/orgs")) return jsonResponse(orgsResponse());
        if (url.includes("/github/repos")) return jsonResponse(reposResponse());
        if (url.includes("/github/prs")) return jsonResponse(prsResponse([]));
        throw new Error(`unexpected request: ${url}`);
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("combobox", { name: "Organization / ユーザー" }));
    fireEvent.click(await screen.findByText("acme-corp"));
    fireEvent.click(await screen.findByRole("combobox", { name: "リポジトリ" }));
    fireEvent.click(await screen.findByText("web-frontend"));

    expect(
      await screen.findByText("レビューを依頼できるOpen状態のPRはありません。"),
    ).toBeInTheDocument();
  });

  it("OP-01: changing the org clears the repo and PR selections", async () => {
    localStorage.setItem("hasGithubToken", "true");
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/github/orgs"))
          return jsonResponse(orgsResponse(["acme-corp", "other-org"]));
        if (url.includes("/github/repos")) return jsonResponse(reposResponse());
        if (url.includes("/github/prs")) return jsonResponse(prsResponse());
        throw new Error(`unexpected request: ${url}`);
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("combobox", { name: "Organization / ユーザー" }));
    fireEvent.click(await screen.findByText("acme-corp"));
    fireEvent.click(await screen.findByRole("combobox", { name: "リポジトリ" }));
    fireEvent.click(await screen.findByText("web-frontend"));
    fireEvent.click(await screen.findByText("#482 Fix login bug"));
    expect(await screen.findByText("レビューエージェントへの送信内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Organization / ユーザー" }));
    fireEvent.click(await screen.findByText("other-org"));

    expect(screen.queryByText("レビューエージェントへの送信内容")).not.toBeInTheDocument();
  });

  it("ST-05/OP-05: selecting a PR shows the submit summary and submitting navigates to the list", async () => {
    localStorage.setItem("hasGithubToken", "true");
    const handler = defaultHandler();
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/reviews") && init?.method === "POST") {
          return jsonResponse(
            {
              reviewId: "acme-corp:web-frontend:pr-482",
              organization: "acme-corp",
              repository: "web-frontend",
              pullRequest: 482,
            },
            201,
          );
        }
        return handler(input);
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("combobox", { name: "Organization / ユーザー" }));
    fireEvent.click(await screen.findByText("acme-corp"));
    fireEvent.click(await screen.findByRole("combobox", { name: "リポジトリ" }));
    fireEvent.click(await screen.findByText("web-frontend"));
    fireEvent.click(await screen.findByText("#482 Fix login bug"));

    expect(await screen.findByText("レビューエージェントへの送信内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "レビュー依頼を送信" }));

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/",
        search: { submitted: "acme-corp/web-frontend #482" },
      }),
    );
  });

  it("shows a conflict notice without navigating when submit returns 409", async () => {
    localStorage.setItem("hasGithubToken", "true");
    const handler = defaultHandler();
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/reviews") && init?.method === "POST") {
          return jsonResponse(
            { apiVersion: "1.0.0", code: "conflict", message: "duplicate", detail: null },
            409,
          );
        }
        return handler(input);
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("combobox", { name: "Organization / ユーザー" }));
    fireEvent.click(await screen.findByText("acme-corp"));
    fireEvent.click(await screen.findByRole("combobox", { name: "リポジトリ" }));
    fireEvent.click(await screen.findByText("web-frontend"));
    fireEvent.click(await screen.findByText("#482 Fix login bug"));
    fireEvent.click(screen.getByRole("button", { name: "レビュー依頼を送信" }));

    expect(
      await screen.findByText("このPRには既に有効なレビュー依頼が存在します。"),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("clears a stale submit notice once a different PR is selected", async () => {
    localStorage.setItem("hasGithubToken", "true");
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/github/orgs")) return jsonResponse(orgsResponse());
        if (url.includes("/github/repos")) return jsonResponse(reposResponse());
        if (url.includes("/github/prs")) {
          return jsonResponse(
            prsResponse([
              { number: 482, title: "Fix login bug" },
              { number: 490, title: "Add i18n support" },
            ]),
          );
        }
        if (url.includes("/reviews") && init?.method === "POST") {
          return jsonResponse(
            { apiVersion: "1.0.0", code: "conflict", message: "duplicate", detail: null },
            409,
          );
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("combobox", { name: "Organization / ユーザー" }));
    fireEvent.click(await screen.findByText("acme-corp"));
    fireEvent.click(await screen.findByRole("combobox", { name: "リポジトリ" }));
    fireEvent.click(await screen.findByText("web-frontend"));
    fireEvent.click(await screen.findByText("#482 Fix login bug"));
    fireEvent.click(screen.getByRole("button", { name: "レビュー依頼を送信" }));
    expect(
      await screen.findByText("このPRには既に有効なレビュー依頼が存在します。"),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByText("#490 Add i18n support"));

    expect(
      screen.queryByText("このPRには既に有効なレビュー依頼が存在します。"),
    ).not.toBeInTheDocument();
  });

  it("OP-06: cancel is a link back to the review list, without submitting", async () => {
    localStorage.setItem("hasGithubToken", "true");
    setApiFetchHandler(defaultHandler());

    renderPage();

    fireEvent.click(await screen.findByRole("combobox", { name: "Organization / ユーザー" }));
    fireEvent.click(await screen.findByText("acme-corp"));
    fireEvent.click(await screen.findByRole("combobox", { name: "リポジトリ" }));
    fireEvent.click(await screen.findByText("web-frontend"));
    fireEvent.click(await screen.findByText("#482 Fix login bug"));

    const cancelLink = await screen.findByRole("link", { name: "キャンセル" });
    expect(cancelLink).toHaveAttribute("href", "/");
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
