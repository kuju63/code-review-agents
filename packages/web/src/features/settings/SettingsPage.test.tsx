import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setApiFetchHandler } from "../../test/setup";
import { SettingsPage } from "./SettingsPage";
import type { GithubSettings } from "./settings.schema";

function settings(overrides: Partial<GithubSettings> = {}): GithubSettings {
  return {
    apiVersion: "1.0.0",
    githubUrl: "https://github.com",
    hasPersonalAccessToken: false,
    updatedAt: "2026-08-09T10:24:00+09:00",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("SettingsPage", () => {
  it("shows a loading indicator, then renders the form with fetched values", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    setApiFetchHandler(vi.fn().mockReturnValue(pending));

    renderPage();

    expect((await screen.findAllByText("読み込み中です…")).length).toBeGreaterThan(0);

    resolveFetch(jsonResponse(settings({ githubUrl: "https://github.example.com" })));

    expect(await screen.findByDisplayValue("https://github.example.com")).toBeInTheDocument();
  });

  it("shows a retry affordance on load failure and reloads on click", async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(settings()));
    setApiFetchHandler(handler);

    renderPage();

    const retryButton = await screen.findByRole("button", { name: "再試行" });
    fireEvent.click(retryButton);

    expect(await screen.findByLabelText("GitHub URL")).toBeInTheDocument();
  });

  it("SET-V01: shows a required error and focuses the URL field when it is blank", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse(settings())));
    renderPage();

    const urlInput = await screen.findByLabelText("GitHub URL");
    fireEvent.change(urlInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("GitHub URLを入力してください。")).toBeInTheDocument();
    expect(urlInput).toHaveFocus();
  });

  it("SET-V05: shows a required error and focuses the token field on first registration with a blank token", async () => {
    setApiFetchHandler(
      vi.fn().mockResolvedValue(jsonResponse(settings({ hasPersonalAccessToken: false }))),
    );
    renderPage();

    await screen.findByLabelText("GitHub URL");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("Personal Access Tokenを入力してください。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Personal Access Token")).toHaveFocus();
  });

  it("saves a first-time registration with both fields and shows the saved notice", async () => {
    const putHandler = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          settings({ githubUrl: "https://github.example.com", hasPersonalAccessToken: true }),
        ),
      );
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") return putHandler(input, init);
        return jsonResponse(settings());
      }),
    );

    renderPage();

    fireEvent.change(await screen.findByLabelText("GitHub URL"), {
      target: { value: "https://github.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Personal Access Token"), {
      target: { value: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("設定を保存しました。")).toBeInTheDocument();
    expect(JSON.parse(String(putHandler.mock.calls[0]?.[1]?.body))).toEqual({
      githubUrl: "https://github.example.com",
      personalAccessToken: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(screen.getByLabelText("Personal Access Token")).toHaveValue("");
  });

  it("saves URL-only updates without sending personalAccessToken when a token is already registered", async () => {
    const putHandler = vi
      .fn()
      .mockResolvedValue(jsonResponse(settings({ hasPersonalAccessToken: true })));
    setApiFetchHandler(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") return putHandler(input, init);
        return jsonResponse(settings({ hasPersonalAccessToken: true }));
      }),
    );

    renderPage();

    await screen.findByLabelText("GitHub URL");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(putHandler).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(putHandler.mock.calls[0]?.[1]?.body))).toEqual({
      githubUrl: "https://github.com",
    });
  });

  it("dismisses the saved notice without changing the saved settings", async () => {
    setApiFetchHandler(
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return jsonResponse(settings({ hasPersonalAccessToken: true }));
        }
        return jsonResponse(settings());
      }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText("Personal Access Token"), {
      target: { value: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("設定を保存しました。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(screen.queryByText("設定を保存しました。")).not.toBeInTheDocument();
  });

  it("disables the save button while the save request is in flight", async () => {
    let resolvePut: (value: Response) => void = () => {};
    setApiFetchHandler(
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return new Promise<Response>((resolve) => {
            resolvePut = resolve;
          });
        }
        return jsonResponse(settings());
      }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText("Personal Access Token"), {
      target: { value: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    const saveButton = screen.getByRole("button", { name: "保存" });
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveButton).toBeDisabled());
    resolvePut(jsonResponse(settings({ hasPersonalAccessToken: true })));
    await waitFor(() => expect(saveButton).not.toBeDisabled());
  });

  it("shows the server's validation message when the server rejects a client-valid submission", async () => {
    setApiFetchHandler(
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return jsonResponse(
            {
              apiVersion: "1.0.0",
              code: "validation_error",
              message: "Personal Access Tokenを入力してください。",
              detail: null,
            },
            422,
          );
        }
        return jsonResponse(settings());
      }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText("Personal Access Token"), {
      target: { value: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("Personal Access Tokenを入力してください。"),
    ).toBeInTheDocument();
  });

  it("shows a generic error notice on an unexpected save failure", async () => {
    setApiFetchHandler(
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") return jsonResponse({}, 500);
        return jsonResponse(settings());
      }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText("Personal Access Token"), {
      target: { value: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("保存に失敗しました。")).toBeInTheDocument();
  });
});
