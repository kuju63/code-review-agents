export interface FileChange {
  path: string;
  patch: string;
}

export class GitHubHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`GitHub API request failed with status ${status}: ${url}`);
    this.name = "GitHubHttpError";
  }
}

export class GitHubRateLimitError extends GitHubHttpError {
  constructor(
    status: number,
    url: string,
    public readonly reset: string | null,
  ) {
    super(status, url);
    this.name = "GitHubRateLimitError";
    this.message = `GitHub API rate limit exceeded (x-ratelimit-reset=${reset}): ${url}`;
  }
}

export interface ApiGetOptions {
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  maxRedirects?: number;
  timeoutMilliseconds?: number;
  now?: () => number;
  maxRetryWaitMilliseconds?: number;
}

export type ApiGet = (url: string, token: string) => Promise<unknown>;

export interface FetchPrFilesOptions {
  apiGet?: ApiGet;
  maxPages?: number;
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MILLISECONDS = 1000;
const MAX_RETRY_WAIT_MILLISECONDS = 62_000;
const MAX_REDIRECTS = 5;
const MAX_PAGES = 100;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "api.github.com" &&
      (parsed.port === "" || parsed.port === "443")
    );
  } catch {
    return false;
  }
}

function assertAllowedUrl(url: string, context = "call"): void {
  if (!isAllowedUrl(url)) {
    throw new Error(`refusing to ${context} a non-https/api.github.com URL: ${url}`);
  }
}

function isRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  );
}

function retryDelayMilliseconds(
  response: Response,
  attempt: number,
  now: () => number,
  maximum: number,
): number {
  const backoff = BASE_BACKOFF_MILLISECONDS * 2 ** attempt;
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, maximum);
  }
  const resetHeader = response.headers.get("x-ratelimit-reset");
  const reset = resetHeader === null ? Number.NaN : Number(resetHeader);
  const resetWait = Number.isFinite(reset) ? Math.max(reset * 1000 - now(), 0) : 0;
  return Math.min(Math.max(backoff, resetWait), maximum);
}

export async function apiGet(
  url: string,
  token: string,
  options: ApiGetOptions = {},
): Promise<unknown> {
  assertAllowedUrl(url);
  const request = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
  const now = options.now ?? Date.now;
  const maxRetryWaitMilliseconds = options.maxRetryWaitMilliseconds ?? MAX_RETRY_WAIT_MILLISECONDS;

  if (maxAttempts < 1) {
    throw new RangeError("maxAttempts must be at least 1");
  }
  if (maxRedirects < 0) {
    throw new RangeError("maxRedirects must not be negative");
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let currentUrl = url;
    let redirects = 0;
    let response: Response | undefined;

    for (;;) {
      try {
        response = await request(currentUrl, {
          method: "GET",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "x-github-api-version": "2022-11-28",
            "user-agent": "code-review-agent-eval",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMilliseconds),
        });
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw error;
        }
        await sleep(BASE_BACKOFF_MILLISECONDS * 2 ** attempt);
        response = undefined;
        break;
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        break;
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new GitHubHttpError(response.status, currentUrl);
      }
      if (redirects >= maxRedirects) {
        throw new Error(`GitHub API redirect limit exceeded: ${url}`);
      }
      const redirectUrl = new URL(location, currentUrl).href;
      assertAllowedUrl(redirectUrl, "follow redirect to");
      currentUrl = redirectUrl;
      redirects += 1;
    }

    if (!response) {
      continue;
    }
    if (response.ok) {
      return response.json() as Promise<unknown>;
    }

    const rateLimited = isRateLimited(response);
    const retryable = response.status === 429 || response.status >= 500 || rateLimited;
    if (!retryable || attempt === maxAttempts - 1) {
      if (rateLimited) {
        throw new GitHubRateLimitError(
          response.status,
          currentUrl,
          response.headers.get("x-ratelimit-reset"),
        );
      }
      throw new GitHubHttpError(response.status, currentUrl);
    }
    await sleep(retryDelayMilliseconds(response, attempt, now, maxRetryWaitMilliseconds));
  }

  throw new Error("GitHub API retry loop exhausted unexpectedly");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function fetchPrFiles(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
  options: FetchPrFilesOptions = {},
): Promise<FileChange[]> {
  const get = options.apiGet ?? apiGet;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const perPage = 100;
  const files: FileChange[] = [];

  if (maxPages < 1) {
    throw new RangeError("maxPages must be at least 1");
  }

  for (let page = 1; page <= maxPages; page += 1) {
    const url =
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files` +
      `?per_page=${perPage}&page=${page}`;
    const pageData = await get(url, token);
    if (!Array.isArray(pageData)) {
      throw new TypeError("GitHub PR files response must be an array");
    }
    for (const item of pageData) {
      if (
        isRecord(item) &&
        typeof item.filename === "string" &&
        item.filename.length > 0 &&
        typeof item.patch === "string" &&
        item.patch.length > 0
      ) {
        files.push({ path: item.filename, patch: item.patch });
      }
    }
    if (pageData.length < perPage) {
      return files;
    }
  }

  throw new Error(`GitHub PR files pagination exceeded ${maxPages} pages`);
}
