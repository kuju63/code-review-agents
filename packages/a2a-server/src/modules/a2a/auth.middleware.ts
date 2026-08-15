import type { MiddlewareHandler } from "hono";

type GithubAuthVariables = {
  githubToken: string;
};

export type GithubAuthEnv = {
  Variables: GithubAuthVariables;
};

type GithubAuthMiddlewareOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createGithubAuthMiddleware({
  fetchImpl = fetch,
  timeoutMs = 10_000,
}: GithubAuthMiddlewareOptions = {}): MiddlewareHandler<GithubAuthEnv> {
  return async (c, next) => {
    const authorization = c.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return c.json({ detail: "Authorization header must be 'Bearer <token>'" }, 401);
    }

    const token = authorization.slice("Bearer ".length);
    let response: Response;
    try {
      response = await fetchImpl("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return c.json({ detail: "GitHub authentication endpoint is temporarily unreachable" }, 503);
    }

    if (response.status !== 200) {
      return c.json({ detail: "Invalid GitHub token" }, 401);
    }

    c.set("githubToken", token);
    await next();
  };
}
