import type { z } from "@hono/zod-openapi";
import type { GithubSettingsSchema, UpdateGithubSettingsRequestSchema } from "./settings.schema.js";

export type GithubSettingsResponse = z.infer<typeof GithubSettingsSchema>;

export type UpdateGithubSettingsInput = z.infer<typeof UpdateGithubSettingsRequestSchema>;

export type UpdateSettingsResult =
  | { ok: true; data: GithubSettingsResponse }
  | { ok: false; code: "validation_error"; message: string };

const DEFAULT_ALLOWED_GITHUB_HOST = "github.com";

export interface GithubCredentials {
  githubUrl: string;
  personalAccessToken: string;
}

export interface SettingsStore {
  getGithubSettings(): GithubSettingsResponse;
  updateGithubSettings(input: UpdateGithubSettingsInput): UpdateSettingsResult;
  /**
   * GitHub呼び出しに使う生のPATを返す (Issue #335 `/github/*` カタログAPI専用)。
   * PAT未登録の場合は null。`getGithubSettings()` は `hasPersonalAccessToken`
   * のみを返し値そのものを露出しないため、このメソッドを別途設ける。
   */
  getCredentials(): GithubCredentials | null;
}

export interface SettingsStoreDeps {
  now?: () => string;
  /**
   * `PUT /settings/github` に認可機構がまだ無い間 (SET-V11)、githubUrlの
   * ホストをデプロイ単位でこの値に固定する暫定策。既定は `github.com`。
   */
  allowedGithubHost?: string;
}

/** 保存時に末尾の連続する `/` を除去する (SET-A01)。ルートのみの `/` は空文字列に畳む。 */
function normalizeGithubUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * SET-V11: ピン留めされたオリジンのパスとして許容するのは空・`/`・末尾の
 * 連続する `/`（SET-A01で正規化される）のみ。`isAllowedRootPath`
 * (settings.schema.ts) と異なり GHES サブパスの1セグメントは許容しない
 * — ここはホスト名だけでなくオリジン全体を固定する用途のため。
 * パーセントエンコードはデコードしてから判定する (`%2F` 等でのすり抜け防止)。
 */
function isRootOnlyPath(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return /^\/*$/.test(decoded);
}

/**
 * プロセス内メモリのダミーストア (Issue #335)。`reviews.store.ts` と同じ成熟度で、
 * DB永続化・暗号化は未実装 (再起動でリセットされる)。PATを暗号化せず平文で
 * 保持している点は既知のギャップであり、DB永続化と同じ後続タスクで解消する。
 */
export function createSettingsStore(deps: SettingsStoreDeps = {}): SettingsStore {
  const now = deps.now ?? (() => new Date().toISOString());
  const allowedGithubHost = (deps.allowedGithubHost ?? DEFAULT_ALLOWED_GITHUB_HOST).toLowerCase();
  // 初期値もallowedGithubHostから正規化する。固定値のままだと、
  // allowedGithubHostをgithub.com以外に設定した運用でGETの初期値をそのまま
  // PUTに送り返した際にホスト不一致で拒否されてしまう (GET/PUTの不整合)。
  let state = {
    githubUrl: normalizeGithubUrl(`https://${allowedGithubHost}`),
    personalAccessToken: null as string | null,
    updatedAt: now(),
  };

  function toResponse(): GithubSettingsResponse {
    return {
      apiVersion: "1.0.0",
      githubUrl: state.githubUrl,
      hasPersonalAccessToken: state.personalAccessToken !== null,
      updatedAt: state.updatedAt,
    };
  }

  return {
    getGithubSettings() {
      return toResponse();
    },
    updateGithubSettings(input) {
      let hostname: string;
      let pathname: string;
      try {
        const url = new URL(input.githubUrl);
        hostname = url.hostname.toLowerCase();
        pathname = url.pathname;
      } catch {
        return {
          ok: false,
          code: "validation_error",
          message: "GitHubインスタンスのルートURLを入力してください。",
        };
      }
      // SET-V11: サーバーが固定するのはホストだけでなくオリジン全体
      // (`https://${allowedGithubHost}` のルートパスのみ)。パスをホスト名の
      // 判定から除外すると、`https://github.com/evil` のように同じホスト名
      // 配下の任意パスへPATが送信されてしまう
      // (`resolveGithubApiBase()` の `=== "https://github.com"` 判定に
      // 一致せず GHES 扱いになり `/evil/api/v3` へリクエストされる)。
      if (hostname !== allowedGithubHost || !isRootOnlyPath(pathname)) {
        return {
          ok: false,
          code: "validation_error",
          message: "許可されていないGitHub URLです。管理者に確認してください。",
        };
      }
      if (state.personalAccessToken === null && input.personalAccessToken === undefined) {
        return {
          ok: false,
          code: "validation_error",
          message: "Personal Access Tokenを入力してください。",
        };
      }
      state = {
        // 大文字小文字の揺れを保存せず正本 (allowedGithubHost) に正規化する。
        // `resolveGithubApiBase()` は `https://github.com` と大文字小文字を
        // 区別して完全一致比較するため、ここで揃えないと
        // `https://GitHub.COM` のような入力が GHES 扱いになってしまう。
        githubUrl: normalizeGithubUrl(`https://${allowedGithubHost}`),
        personalAccessToken: input.personalAccessToken ?? state.personalAccessToken,
        updatedAt: now(),
      };
      return { ok: true, data: toResponse() };
    },
    getCredentials() {
      if (state.personalAccessToken === null) return null;
      return { githubUrl: state.githubUrl, personalAccessToken: state.personalAccessToken };
    },
  };
}
