import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * `PUT /settings/github` を保護する認可機構が未実装のため (SET-V11)、
   * 保存を受け付けるgithubUrlのホストをデプロイ単位でサーバー側に固定する
   * 暫定策。GitHub Enterprise Serverを使う場合は運用者が明示的に設定する。
   */
  GITHUB_ALLOWED_HOST: z.string().trim().min(1).default("github.com"),
});

export type AppConfig = {
  port: number;
  githubAllowedHost: string;
};

export function loadConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    githubAllowedHost: parsed.GITHUB_ALLOWED_HOST.toLowerCase(),
  };
}
