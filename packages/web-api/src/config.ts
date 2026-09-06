import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
});

export type AppConfig = {
  port: number;
};

export function loadConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
  };
}
