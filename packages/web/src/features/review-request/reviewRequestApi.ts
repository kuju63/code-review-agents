import {
  ErrorResponseSchema,
  type GithubOrg,
  GithubOrgListResponseSchema,
  type GithubPullRequest,
  GithubPullRequestListResponseSchema,
  type GithubRepository,
  GithubRepositoryListResponseSchema,
  type RegisterReviewRequest,
  type Review,
  ReviewSchema,
} from "./reviewRequest.schema";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** `/github/*`が401を返す状態 (RR-13とは別の「認証情報が無効または期限切れ」状態)。 */
export class GithubUnauthorizedError extends Error {}

/** `/github/*`が401以外の非2xxを返す状態 (RR-15汎用エラー)。 */
export class GithubUpstreamFailureError extends Error {}

async function githubApiFetch(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (response.status === 401) {
    throw new GithubUnauthorizedError(`GET ${url} failed with status 401`);
  }
  if (!response.ok) {
    throw new GithubUpstreamFailureError(`GET ${url} failed with status ${response.status}`);
  }
  return response.json();
}

export async function fetchGithubOrgs(): Promise<GithubOrg[]> {
  const json = await githubApiFetch(`${API_BASE_URL}/github/orgs`);
  return GithubOrgListResponseSchema.parse(json).items;
}

export async function fetchGithubRepositories(org: string): Promise<GithubRepository[]> {
  const json = await githubApiFetch(`${API_BASE_URL}/github/repos?org=${encodeURIComponent(org)}`);
  return GithubRepositoryListResponseSchema.parse(json).items;
}

export async function fetchGithubPullRequests(
  org: string,
  repo: string,
): Promise<GithubPullRequest[]> {
  const json = await githubApiFetch(
    `${API_BASE_URL}/github/prs?org=${encodeURIComponent(org)}&repo=${encodeURIComponent(repo)}`,
  );
  return GithubPullRequestListResponseSchema.parse(json).items;
}

export type SubmitReviewRequestResult =
  | { ok: true; data: Review }
  | {
      ok: false;
      code: "conflict" | "validation_error" | "upstream_github_failure";
      message: string;
    };

/**
 * `idempotencyKey`は呼び出し側 (useReviewRequestSelection.ts) が選択
 * (organization, repository, pullRequest) ごとに1回だけ生成し、同一選択への
 * 再送では使い回す — ここで新規生成しない (二重送信防止, OP-05/ST-06)。
 */
export async function submitReviewRequest(
  input: RegisterReviewRequest,
  idempotencyKey: string,
): Promise<SubmitReviewRequestResult> {
  const response = await fetch(`${API_BASE_URL}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });

  if (response.status === 201 || response.status === 200) {
    return { ok: true, data: ReviewSchema.parse(await response.json()) };
  }
  if (response.status === 409 || response.status === 422 || response.status === 502) {
    const body = ErrorResponseSchema.parse(await response.json());
    const code =
      response.status === 409
        ? "conflict"
        : response.status === 422
          ? "validation_error"
          : "upstream_github_failure";
    return { ok: false, code, message: body.message };
  }
  throw new Error(`POST /reviews failed with unexpected status ${response.status}`);
}
