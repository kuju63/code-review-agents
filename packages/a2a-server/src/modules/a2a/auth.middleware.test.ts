import { describe, expect, it, vi } from "vitest";
import { createGithubAuthMiddleware } from "./auth.middleware.js";

const callMiddleware = async (authorization: string | null, fetchImpl: typeof fetch = vi.fn()) => {
  const middleware = createGithubAuthMiddleware({ fetchImpl });
  const context = {
    req: { header: vi.fn(() => authorization) },
    set: vi.fn(),
    json: vi.fn((body: unknown, status: number) => ({ body, status })),
  };
  const next = vi.fn(async () => undefined);

  const result = await middleware(context as never, next);

  return { context, next, result };
};

describe("GitHub auth middleware", () => {
  it("stores the verified bearer token and continues", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;

    const { context, next } = await callMiddleware("Bearer ghp_validtoken", fetchImpl);

    expect(context.set).toHaveBeenCalledWith("githubToken", "ghp_validtoken");
    expect(fetchImpl).toHaveBeenCalledWith("https://api.github.com/user", {
      headers: { Authorization: "Bearer ghp_validtoken" },
      signal: expect.any(AbortSignal),
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when the authorization header is missing", async () => {
    const { result, next } = await callMiddleware(null);

    expect(result).toEqual({
      status: 401,
      body: { detail: "Authorization header must be 'Bearer <token>'" },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when GitHub rejects the token", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 401 }),
    ) as unknown as typeof fetch;

    const { result, next } = await callMiddleware("Bearer ghp_invalidtoken", fetchImpl);

    expect(result).toEqual({ status: 401, body: { detail: "Invalid GitHub token" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 when GitHub authentication is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("name resolution failed");
    }) as unknown as typeof fetch;

    const { result, next } = await callMiddleware("Bearer ghp_validtoken", fetchImpl);

    expect(result).toEqual({
      status: 503,
      body: { detail: "GitHub authentication endpoint is temporarily unreachable" },
    });
    expect(next).not.toHaveBeenCalled();
  });
});
