import { z } from "zod";

/**
 * ホスト名のみ（スキーム・ポート・パス・認証情報を含まない）を許容する。
 * ラベルごとに英数字始端/終端・ハイフン可・63文字以内という一般的なホスト名
 * 制約に従うため、`:`（ポート/認証情報区切り）や `/`（パス区切り）を含む値は
 * 自然に拒否される。settings.store.ts の hostname 比較 (`new URL().hostname`)
 * とここでの検証がずれると、ポートやパス混じりの値を設定した場合に
 * GitHub連携設定の更新が常に拒否される「静かな機能不全」になるため、
 * 起動時のenv検証で fail-fast させる。
 */
const HOSTNAME_ONLY_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * `PUT /settings/github` を保護する認可機構が未実装のため (SET-V11)、
   * 保存を受け付けるgithubUrlのホストをデプロイ単位でサーバー側に固定する
   * 暫定策。GitHub Enterprise Serverを使う場合は運用者が明示的に設定する。
   */
  GITHUB_ALLOWED_HOST: z
    .string()
    .trim()
    .min(1)
    .regex(
      HOSTNAME_ONLY_PATTERN,
      "GITHUB_ALLOWED_HOST must be a bare hostname without scheme, port, path, or credentials",
    )
    .default("github.com"),
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
