import { describe, expect, it, vi } from "vitest";
import { setApiFetchHandler } from "../../test/setup";
import {
  fetchGithubOrgs,
  fetchGithubPullRequests,
  fetchGithubRepositories,
  GithubUnauthorizedError,
  GithubUpstreamFailureError,
  submitReviewRequest,
} from "./reviewRequestApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorBody(code: string, message: string) {
  return { apiVersion: "1.0.0", code, message, detail: null };
}

describe("fetchGithubOrgs", () => {
  it("returns parsed org items on 200", async () => {
    setApiFetchHandler(
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ apiVersion: "1.0.0", items: [{ name: "acme-corp", id: 1 }] }),
        ),
    );

    const result = await fetchGithubOrgs();

    expect(result).toEqual([{ name: "acme-corp", id: 1 }]);
  });

  it("requests /github/orgs", async () => {
    const handler = vi.fn().mockResolvedValue(jsonResponse({ apiVersion: "1.0.0", items: [] }));
    setApiFetchHandler(handler);

    await fetchGithubOrgs();

    expect(String(handler.mock.calls[0]?.[0])).toContain("/github/orgs");
  });

  it("throws GithubUnauthorizedError on 401", async () => {
    setApiFetchHandler(
      vi.fn().mockResolvedValue(jsonResponse(errorBody("unauthorized", "invalid token"), 401)),
    );

    await expect(fetchGithubOrgs()).rejects.toBeInstanceOf(GithubUnauthorizedError);
  });

  it("throws GithubUpstreamFailureError on 502", async () => {
    setApiFetchHandler(
      vi.fn().mockResolvedValue(jsonResponse(errorBody("upstream_github_failure", "boom"), 502)),
    );

    await expect(fetchGithubOrgs()).rejects.toBeInstanceOf(GithubUpstreamFailureError);
  });
});

describe("fetchGithubRepositories", () => {
  it("requests /github/repos with the org query param", async () => {
    const handler = vi.fn().mockResolvedValue(jsonResponse({ apiVersion: "1.0.0", items: [] }));
    setApiFetchHandler(handler);

    await fetchGithubRepositories("acme-corp");

    const url = new URL(String(handler.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toContain("/github/repos");
    expect(url.searchParams.get("org")).toBe("acme-corp");
  });

  it("returns parsed repository items", async () => {
    setApiFetchHandler(
      vi.fn().mockResolvedValue(
        jsonResponse({
          apiVersion: "1.0.0",
          items: [{ name: "web-frontend", id: 1, defaultBranch: "main", openIssuesCount: 2 }],
        }),
      ),
    );

    expect(await fetchGithubRepositories("acme-corp")).toEqual([
      { name: "web-frontend", id: 1, defaultBranch: "main", openIssuesCount: 2 },
    ]);
  });
});

describe("fetchGithubPullRequests", () => {
  it("requests /github/prs with org and repo query params", async () => {
    const handler = vi.fn().mockResolvedValue(jsonResponse({ apiVersion: "1.0.0", items: [] }));
    setApiFetchHandler(handler);

    await fetchGithubPullRequests("acme-corp", "web-frontend");

    const url = new URL(String(handler.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toContain("/github/prs");
    expect(url.searchParams.get("org")).toBe("acme-corp");
    expect(url.searchParams.get("repo")).toBe("web-frontend");
  });
});

describe("submitReviewRequest", () => {
  const input = { organization: "acme-corp", repository: "web-frontend", pullRequest: 482 };
  const review = { reviewId: "acme-corp:web-frontend:pr-482", ...input };

  it("sends the Idempotency-Key header", async () => {
    const handler = vi.fn().mockResolvedValue(jsonResponse(review, 201));
    setApiFetchHandler(handler);

    await submitReviewRequest(input, "key-1");

    const init = handler.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Idempotency-Key")).toBe("key-1");
  });

  it("returns ok on 201 (created)", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse(review, 201)));

    expect(await submitReviewRequest(input, "key-1")).toEqual({ ok: true, data: review });
  });

  it("returns ok on 200 (idempotency replay of an existing review)", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse(review, 200)));

    expect(await submitReviewRequest(input, "key-1")).toEqual({ ok: true, data: review });
  });

  it("returns a conflict result on 409 without throwing", async () => {
    setApiFetchHandler(
      vi.fn().mockResolvedValue(jsonResponse(errorBody("conflict", "duplicate"), 409)),
    );

    expect(await submitReviewRequest(input, "key-1")).toEqual({
      ok: false,
      code: "conflict",
      message: "duplicate",
    });
  });

  it("returns a validation_error result on 422", async () => {
    setApiFetchHandler(
      vi.fn().mockResolvedValue(jsonResponse(errorBody("validation_error", "bad input"), 422)),
    );

    expect(await submitReviewRequest(input, "key-1")).toEqual({
      ok: false,
      code: "validation_error",
      message: "bad input",
    });
  });

  it("returns an upstream_github_failure result on 502", async () => {
    setApiFetchHandler(
      vi.fn().mockResolvedValue(jsonResponse(errorBody("upstream_github_failure", "boom"), 502)),
    );

    expect(await submitReviewRequest(input, "key-1")).toEqual({
      ok: false,
      code: "upstream_github_failure",
      message: "boom",
    });
  });

  it("throws on an unexpected status code", async () => {
    setApiFetchHandler(vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    await expect(submitReviewRequest(input, "key-1")).rejects.toBeTruthy();
  });
});
