import { type GithubSettings, GithubSettingsSchema } from "./settings.schema";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const SETTINGS_QUERY_KEY = ["settings", "github"] as const;

const GITHUB_TOKEN_FLAG_KEY = "hasGithubToken";

/**
 * Keeps SCR-01's PAT gate (ReviewListPage.tsx reads this same key directly)
 * in sync with the latest known server state. This module is currently the
 * only writer; the key is duplicated as a literal in ReviewListPage.tsx
 * rather than shared, since that's the only reader.
 */
export function persistHasGithubTokenFlag(value: boolean): void {
  try {
    localStorage.setItem(GITHUB_TOKEN_FLAG_KEY, value ? "true" : "false");
  } catch {
    // Private-mode/disabled storage: the gate just won't reflect saved settings across visits.
  }
}

export async function fetchGithubSettings(): Promise<GithubSettings> {
  const response = await fetch(`${API_BASE_URL}/settings/github`);
  if (!response.ok) {
    throw new Error(`GET /settings/github failed with status ${response.status}`);
  }
  return GithubSettingsSchema.parse(await response.json());
}

export interface UpdateGithubSettingsInput {
  githubUrl: string;
  personalAccessToken?: string;
}

export type UpdateGithubSettingsResult =
  | { ok: true; data: GithubSettings }
  | { ok: false; code: "validation_error"; message: string };

/**
 * `personalAccessToken` is only included in the request body when the caller
 * provides one — an omitted field (not an empty string) is the PUT contract's
 * "keep the existing PAT" signal (SET-A03 / packages/web-api settings.store.ts).
 */
export async function updateGithubSettings(
  input: UpdateGithubSettingsInput,
): Promise<UpdateGithubSettingsResult> {
  const body: UpdateGithubSettingsInput = { githubUrl: input.githubUrl };
  if (input.personalAccessToken !== undefined) {
    body.personalAccessToken = input.personalAccessToken;
  }

  const response = await fetch(`${API_BASE_URL}/settings/github`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.status === 200) {
    return { ok: true, data: GithubSettingsSchema.parse(await response.json()) };
  }
  if (response.status === 422) {
    const errorBody = (await response.json()) as { message?: unknown };
    return {
      ok: false,
      code: "validation_error",
      message: typeof errorBody.message === "string" ? errorBody.message : "",
    };
  }
  throw new Error(`PUT /settings/github failed with unexpected status ${response.status}`);
}
