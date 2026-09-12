import { z } from "zod";

/**
 * Client-side mirror of `docs/openapi/reviews.yaml`'s GithubSettings schema
 * (SCR-04). See review-list/reviews.schema.ts for why this doesn't import
 * packages/web-api's schema module directly.
 */
export const GithubSettingsSchema = z.object({
  apiVersion: z.string(),
  githubUrl: z.string(),
  hasPersonalAccessToken: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type GithubSettings = z.infer<typeof GithubSettingsSchema>;

export type GithubUrlErrorCode = "required" | "tooLong" | "invalidHttps" | "invalidRoot";
export type PersonalAccessTokenErrorCode =
  | "required"
  | "invalidLength"
  | "invalidPrefix"
  | "incomplete";

/**
 * `URL#pathname` check for SET-V04: empty, `/`, or a single fixed base-path
 * segment (GHE subpath deployments) only — rejects `//` runs and deeper paths.
 * `URL#pathname` keeps percent-encoding as-is, so the check decodes first;
 * an encoded `/` or `\` (e.g. `%2F`, `%5C`) would otherwise smuggle an extra
 * path segment past the single-segment check. A decode failure is rejected.
 * Mirrors packages/web-api/src/modules/settings/settings.schema.ts.
 */
function isAllowedRootPath(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded === "" || decoded === "/") return true;
  return /^\/[^/\\]+$/.test(decoded);
}

/** SET-V01〜V04. Returns an error code (mapped to a message by the caller via i18n) or undefined. */
export function validateGithubUrl(rawValue: string): GithubUrlErrorCode | undefined {
  const value = rawValue.trim();
  if (value.length === 0) return "required";
  if (value.length > 2048) return "tooLong";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "invalidHttps";
  }
  if (url.protocol !== "https:") return "invalidHttps";
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    return "invalidRoot";
  }
  if (!isAllowedRootPath(url.pathname)) return "invalidRoot";
  return undefined;
}

/** SET-A01: trims and drops the trailing `/` run before sending. */
export function normalizeGithubUrl(rawValue: string): string {
  return rawValue.trim().replace(/\/+$/, "");
}

/**
 * SET-V05〜V09. `hasExistingToken` controls whether a blank value is allowed
 * (SET-V05: a blank value on an update means "keep the current PAT").
 */
export function validatePersonalAccessToken(
  rawValue: string,
  hasExistingToken: boolean,
): PersonalAccessTokenErrorCode | undefined {
  if (rawValue.length === 0) {
    return hasExistingToken ? undefined : "required";
  }
  // SET-V06 checks the raw (untrimmed) value on purpose: whitespace anywhere is an error, not something to trim.
  if (rawValue.length > 4096 || /\s/.test(rawValue)) return "invalidLength";
  if (!rawValue.startsWith("ghp_") && !rawValue.startsWith("github_pat_")) return "invalidPrefix";
  if (!/^(ghp_|github_pat_)\S+$/.test(rawValue)) return "incomplete";
  return undefined;
}
