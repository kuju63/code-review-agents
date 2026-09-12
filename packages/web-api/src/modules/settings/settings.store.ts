import type { z } from "@hono/zod-openapi";
import type { GithubSettingsSchema, UpdateGithubSettingsRequestSchema } from "./settings.schema.js";

export type GithubSettingsResponse = z.infer<typeof GithubSettingsSchema>;

export type UpdateGithubSettingsInput = z.infer<typeof UpdateGithubSettingsRequestSchema>;

export type UpdateSettingsResult =
  | { ok: true; data: GithubSettingsResponse }
  | { ok: false; code: "validation_error"; message: string };

export interface SettingsStore {
  getGithubSettings(): GithubSettingsResponse;
  updateGithubSettings(input: UpdateGithubSettingsInput): UpdateSettingsResult;
}

export interface SettingsStoreDeps {
  now?: () => string;
}

/** 保存時に末尾の連続する `/` を除去する (SET-A01)。ルートのみの `/` は空文字列に畳む。 */
function normalizeGithubUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * プロセス内メモリのダミーストア (Issue #335)。`reviews.store.ts` と同じ成熟度で、
 * DB永続化・暗号化は未実装 (再起動でリセットされる)。PATを暗号化せず平文で
 * 保持している点は既知のギャップであり、DB永続化と同じ後続タスクで解消する。
 */
export function createSettingsStore(deps: SettingsStoreDeps = {}): SettingsStore {
  const now = deps.now ?? (() => new Date().toISOString());
  let state = {
    githubUrl: "https://github.com",
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
      if (state.personalAccessToken === null && input.personalAccessToken === undefined) {
        return {
          ok: false,
          code: "validation_error",
          message: "Personal Access Tokenを入力してください。",
        };
      }
      state = {
        githubUrl: normalizeGithubUrl(input.githubUrl),
        personalAccessToken: input.personalAccessToken ?? state.personalAccessToken,
        updatedAt: now(),
      };
      return { ok: true, data: toResponse() };
    },
  };
}
