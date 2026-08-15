export type ProviderType = "openai" | "ollama";

export type ServerSettings = {
  providerType: ProviderType;
  llmBaseUrl: string | undefined;
  modelId: string;
  maxTokens: number | undefined;
  frequencyPenalty: number | undefined;
};

const DEFAULT_MODEL_ID = "gpt-4o";

function parseProviderType(raw: string | undefined): ProviderType {
  if (raw === undefined || raw === "") {
    return "openai";
  }
  if (raw === "openai" || raw === "ollama") {
    return raw;
  }
  throw new Error(
    `Unsupported CODE_REVIEW_PROVIDER_TYPE: "${raw}" (expected "openai" or "ollama")`,
  );
}

function parseOptionalNumber(raw: string | undefined, envVarName: string): number | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid ${envVarName}: "${raw}" is not a number`);
  }
  return value;
}

/** Read `CODE_REVIEW_`-prefixed provider settings, mirroring Python's `Settings` (config.py). */
export function loadServerSettingsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ServerSettings {
  return {
    providerType: parseProviderType(env.CODE_REVIEW_PROVIDER_TYPE),
    llmBaseUrl: env.CODE_REVIEW_LLM_BASE_URL || undefined,
    modelId: env.CODE_REVIEW_MODEL_ID || DEFAULT_MODEL_ID,
    maxTokens: parseOptionalNumber(env.CODE_REVIEW_MAX_TOKENS, "CODE_REVIEW_MAX_TOKENS"),
    frequencyPenalty: parseOptionalNumber(
      env.CODE_REVIEW_FREQUENCY_PENALTY,
      "CODE_REVIEW_FREQUENCY_PENALTY",
    ),
  };
}
