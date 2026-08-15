import { describe, expect, it } from "vitest";
import { loadServerSettingsFromEnv } from "./config.js";

describe("loadServerSettingsFromEnv", () => {
  it("defaults to the openai provider with gpt-4o and no overrides", () => {
    const settings = loadServerSettingsFromEnv({});

    expect(settings).toEqual({
      providerType: "openai",
      llmBaseUrl: undefined,
      modelId: "gpt-4o",
      maxTokens: undefined,
      frequencyPenalty: undefined,
    });
  });

  it("reads CODE_REVIEW_-prefixed overrides", () => {
    const settings = loadServerSettingsFromEnv({
      CODE_REVIEW_PROVIDER_TYPE: "ollama",
      CODE_REVIEW_LLM_BASE_URL: "http://localhost:11434",
      CODE_REVIEW_MODEL_ID: "hf.co/deepreinforce-ai/Ornith-1.0-35B-GGUF:Q4_K_M",
      CODE_REVIEW_MAX_TOKENS: "6000",
      CODE_REVIEW_FREQUENCY_PENALTY: "0.5",
    });

    expect(settings).toEqual({
      providerType: "ollama",
      llmBaseUrl: "http://localhost:11434",
      modelId: "hf.co/deepreinforce-ai/Ornith-1.0-35B-GGUF:Q4_K_M",
      maxTokens: 6000,
      frequencyPenalty: 0.5,
    });
  });

  it("treats an empty CODE_REVIEW_LLM_BASE_URL as unset", () => {
    const settings = loadServerSettingsFromEnv({ CODE_REVIEW_LLM_BASE_URL: "" });

    expect(settings.llmBaseUrl).toBeUndefined();
  });

  it("throws on an unsupported CODE_REVIEW_PROVIDER_TYPE", () => {
    expect(() =>
      loadServerSettingsFromEnv({ CODE_REVIEW_PROVIDER_TYPE: "anthropic" }),
    ).toThrowError(/CODE_REVIEW_PROVIDER_TYPE/);
  });

  it("throws on a non-numeric CODE_REVIEW_MAX_TOKENS", () => {
    expect(() =>
      loadServerSettingsFromEnv({ CODE_REVIEW_MAX_TOKENS: "not-a-number" }),
    ).toThrowError(/CODE_REVIEW_MAX_TOKENS/);
  });

  it("throws on a non-numeric CODE_REVIEW_FREQUENCY_PENALTY", () => {
    expect(() =>
      loadServerSettingsFromEnv({ CODE_REVIEW_FREQUENCY_PENALTY: "not-a-number" }),
    ).toThrowError(/CODE_REVIEW_FREQUENCY_PENALTY/);
  });
});
