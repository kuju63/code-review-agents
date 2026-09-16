import type { GithubCredentials } from "../settings/settings.store.js";
import {
  GithubOrgSchema,
  GithubPullRequestSchema,
  GithubRepositorySchema,
} from "./github.schema.js";

export type GithubApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "unauthorized" | "upstream_github_failure"; message: string };

export interface GithubApiClientOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMilliseconds?: number;
}

export interface GithubOrg {
  name: string;
  id: number;
}

export interface GithubRepository {
  name: string;
  id: number;
  defaultBranch: string;
  openIssuesCount: number;
}

export interface GithubPullRequest {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  author: string;
  baseBranch: string;
}

const MALFORMED_RESPONSE_MESSAGE = "GitHubからの応答を解釈できませんでした。";

/**
 * `githubUrl` から REST API base を導出する。github.com は `api.github.com`
 * サブドメイン、GitHub Enterprise Server (GHES) はルートURL配下の `/api/v3`
 * という別規約のため (evaluation/src/lib/github-rest.ts の `api.github.com`
 * 固定ロジックは流用できない)。
 */
export function resolveGithubApiBase(githubUrl: string): string {
  const normalized = githubUrl.replace(/\/+$/, "");
  if (normalized === "https://github.com" || normalized === "") {
    return "https://api.github.com";
  }
  return `${normalized}/api/v3`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function githubApiGet(
  url: string,
  token: string,
  options: GithubApiClientOptions,
): Promise<GithubApiResult<unknown>> {
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;

  let response: Response;
  try {
    response = await request(url, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "code-review-agent-web-api",
      },
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
  } catch {
    return {
      ok: false,
      code: "upstream_github_failure",
      message: "GitHubへの接続に失敗しました。設定を確認してください。",
    };
  }

  if (response.status === 401) {
    return {
      ok: false,
      code: "unauthorized",
      message: "GitHub連携が未設定か、Personal Access Tokenが無効です。設定を確認してください。",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "upstream_github_failure",
      message: "GitHubへの接続に失敗しました。設定を確認してください。",
    };
  }

  try {
    return { ok: true, data: (await response.json()) as unknown };
  } catch {
    return {
      ok: false,
      code: "upstream_github_failure",
      message: MALFORMED_RESPONSE_MESSAGE,
    };
  }
}

/**
 * GitHub REST呼び出し結果 (`githubApiGet` の `data`) を厳格な型へ変換する。
 * `map*` はペイロードが不正な形状のとき常に例外 (`TypeError` または
 * `github.schema.ts` の対応スキーマが投げる `ZodError`) を投げ、呼び出し元の
 * `listGithub*` がそれを捕捉して `upstream_github_failure` へ変換する
 * (欠落フィールドを `String(undefined)` のように黙って文字列化しない)。
 * 数値・日時の制約 (整数／非負／有効範囲／RFC3339) は `github.schema.ts` の
 * response schema を単一の正本として検証し、ここでは重複定義しない。
 */
function mapOrgs(data: unknown): GithubOrg[] {
  if (!Array.isArray(data)) {
    throw new TypeError("GitHub orgs response must be an array");
  }
  return data.map((item) => {
    if (!isRecord(item) || typeof item.login !== "string") {
      throw new TypeError("GitHub org item is malformed");
    }
    return GithubOrgSchema.parse({ name: item.login, id: item.id });
  });
}

function mapRepositories(data: unknown): GithubRepository[] {
  if (!Array.isArray(data)) {
    throw new TypeError("GitHub repos response must be an array");
  }
  return data.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      typeof item.default_branch !== "string"
    ) {
      throw new TypeError("GitHub repository item is malformed");
    }
    return GithubRepositorySchema.parse({
      name: item.name,
      id: item.id,
      defaultBranch: item.default_branch,
      openIssuesCount: item.open_issues_count,
    });
  });
}

function mapPullRequests(data: unknown): GithubPullRequest[] {
  if (!Array.isArray(data)) {
    throw new TypeError("GitHub pulls response must be an array");
  }
  return data.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.title !== "string" ||
      !isRecord(item.user) ||
      typeof item.user.login !== "string" ||
      !isRecord(item.base) ||
      typeof item.base.ref !== "string"
    ) {
      throw new TypeError("GitHub pull request item is malformed");
    }
    return GithubPullRequestSchema.parse({
      number: item.number,
      title: item.title,
      state: item.state,
      createdAt: item.created_at,
      author: item.user.login,
      baseBranch: item.base.ref,
    });
  });
}

export async function listGithubOrgs(
  credentials: GithubCredentials,
  options: GithubApiClientOptions = {},
): Promise<GithubApiResult<GithubOrg[]>> {
  const base = resolveGithubApiBase(credentials.githubUrl);
  const result = await githubApiGet(
    `${base}/user/orgs?per_page=100`,
    credentials.personalAccessToken,
    options,
  );
  if (!result.ok) return result;
  try {
    return { ok: true, data: mapOrgs(result.data) };
  } catch {
    return { ok: false, code: "upstream_github_failure", message: MALFORMED_RESPONSE_MESSAGE };
  }
}

export async function listGithubRepositories(
  credentials: GithubCredentials,
  org: string,
  options: GithubApiClientOptions = {},
): Promise<GithubApiResult<GithubRepository[]>> {
  const base = resolveGithubApiBase(credentials.githubUrl);
  const url = `${base}/orgs/${encodeURIComponent(org)}/repos?per_page=100`;
  const result = await githubApiGet(url, credentials.personalAccessToken, options);
  if (!result.ok) return result;
  try {
    return { ok: true, data: mapRepositories(result.data) };
  } catch {
    return { ok: false, code: "upstream_github_failure", message: MALFORMED_RESPONSE_MESSAGE };
  }
}

export async function listGithubPullRequests(
  credentials: GithubCredentials,
  org: string,
  repo: string,
  options: GithubApiClientOptions = {},
): Promise<GithubApiResult<GithubPullRequest[]>> {
  const base = resolveGithubApiBase(credentials.githubUrl);
  const url = `${base}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/pulls?state=open&per_page=100`;
  const result = await githubApiGet(url, credentials.personalAccessToken, options);
  if (!result.ok) return result;
  try {
    return { ok: true, data: mapPullRequests(result.data) };
  } catch {
    return { ok: false, code: "upstream_github_failure", message: MALFORMED_RESPONSE_MESSAGE };
  }
}
