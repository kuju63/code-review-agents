import { z } from "@hono/zod-openapi";
import { ApiVersionSchema } from "../reviews/reviews.schema.js";

/**
 * `URL#pathname` の絶対パス表現に対する SET-V04 の判定。空・`/`・単一の
 * 固定ベースパスセグメント (GHE サブパス運用) のみ許容し、`//` の連続や
 * 多階層パスは拒否する。ベースパスの正当性そのもの (どの文字列が「正しい
 * ベースパス」か) はテナント固有の外部設定に依存するため判定しない。
 */
function isAllowedRootPath(pathname: string): boolean {
  if (pathname === "" || pathname === "/") return true;
  return /^\/[^/]+$/.test(pathname);
}

/** GitHub連携先のルートURL (SCR-04 SET-V01〜V04)。 */
const GithubUrlSchema = z
  .string()
  .trim()
  .min(1, "GitHub URLを入力してください。")
  .max(2048, "GitHub URLは2,048文字以内で入力してください。")
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HTTPS形式のGitHub URLを入力してください。",
      });
      return;
    }
    if (url.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HTTPS形式のGitHub URLを入力してください。",
      });
      return;
    }
    if (!url.hostname || url.username || url.password || url.search || url.hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GitHubインスタンスのルートURLを入力してください。",
      });
      return;
    }
    if (!isAllowedRootPath(url.pathname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GitHubインスタンスのルートURLを入力してください。",
      });
    }
  });

/**
 * Personal Access Token (SCR-04 SET-V05〜V09)。省略時は既存PATを変更しない
 * 契約のため、必須チェック (SET-V05) はストア側 (既存登録の有無に依存) で行う。
 */
const PersonalAccessTokenSchema = z
  .string()
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    if (value.length > 4096 || /\s/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Personal Access Tokenは空白を含めず4,096文字以内で入力してください。",
      });
      return;
    }
    if (!value.startsWith("ghp_") && !value.startsWith("github_pat_")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Personal Access TokenはClassic（ghp_）またはFine-grained（github_pat_）形式で入力してください。",
      });
      return;
    }
    if (!/^(ghp_|github_pat_)\S+$/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Personal Access Tokenの値が不足しています。",
      });
    }
  });

/**
 * GitHub連携設定 (SCR-04)。デプロイ単位に1つだけ存在する単一リソース。
 * PATの値そのものは含まず、登録有無のみ `hasPersonalAccessToken` で表現する。
 */
export const GithubSettingsSchema = z
  .object({
    apiVersion: ApiVersionSchema,
    githubUrl: z.string(),
    hasPersonalAccessToken: z.boolean(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .openapi("GithubSettings");

/** GitHub連携設定の保存 (SCR-04 送信データ)。 */
export const UpdateGithubSettingsRequestSchema = z
  .object({
    githubUrl: GithubUrlSchema,
    personalAccessToken: PersonalAccessTokenSchema,
  })
  .openapi("UpdateGithubSettingsRequest");
