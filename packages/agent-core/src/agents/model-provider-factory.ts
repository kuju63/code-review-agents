import type { Model } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import { createOllama } from "ai-sdk-ollama";

/** LLM backend a reviewer/agent talks to. */
export type ProviderType = "openai" | "ollama";
export const ProviderType = {
  OPENAI: "openai",
  OLLAMA: "ollama",
} as const satisfies Record<string, ProviderType>;

const DEFAULT_OLLAMA_HOST = "http://localhost:11434";

export interface CreateModelProviderOptions {
  /**
   * OpenAI-compatible base URL (OpenAI branch) or bare Ollama server host
   * (Ollama branch, e.g. `http://host:11434` -- NOT the `/v1` OpenAI-compat
   * suffix). Defaults to `http://localhost:11434` when unset and provider is
   * Ollama.
   */
  llmBaseUrl?: string | undefined;
  /**
   * Sampling temperature. OpenAI: applied only when `llmBaseUrl` is set
   * (preserves pre-existing behavior). Ollama: always applied.
   */
  temperature: number;
  /** Optional generation cap, forwarded verbatim. */
  maxTokens?: number | undefined;
  /**
   * OpenAI Chat Completions-specific repeat penalty. Ollama has no
   * equivalent option; ignored (with a warning) when providerType is OLLAMA.
   */
  frequencyPenalty?: number | undefined;
}

/** Build the Strands `Model` for `providerType`. */
export function createModelProvider(
  providerType: ProviderType,
  modelId: string,
  options: CreateModelProviderOptions,
): Model {
  const { llmBaseUrl, temperature, maxTokens, frequencyPenalty } = options;

  switch (providerType) {
    case ProviderType.OPENAI:
      return new OpenAIModel({
        api: "chat",
        modelId,
        ...(llmBaseUrl ? { clientConfig: { baseURL: llmBaseUrl }, temperature } : {}),
        ...(maxTokens != null ? { maxTokens } : {}),
        ...(frequencyPenalty != null ? { frequencyPenalty } : {}),
      });

    case ProviderType.OLLAMA: {
      if (frequencyPenalty != null) {
        console.warn(
          `frequencyPenalty=${frequencyPenalty} ignored: Ollama has no equivalent ` +
            "parameter (providerType=ollama)",
        );
      }
      const rawHost = llmBaseUrl || DEFAULT_OLLAMA_HOST;
      const rstripped = rawHost.replace(/\/+$/, "");
      const host = rstripped.endsWith("/v1") ? rstripped.slice(0, -"/v1".length) : rawHost;
      const provider = createOllama({ baseURL: host });
      return new VercelModel({
        provider: provider(modelId),
        temperature,
        ...(maxTokens != null ? { maxTokens } : {}),
      });
    }

    default: {
      const exhaustiveCheck: never = providerType;
      throw new Error(`Unsupported provider type: ${String(exhaustiveCheck)}`);
    }
  }
}
