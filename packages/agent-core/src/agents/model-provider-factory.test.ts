import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import { createOllama } from "ai-sdk-ollama";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createModelProvider, ProviderType } from "./model-provider-factory.js";

vi.mock("@strands-agents/sdk/models/openai", () => ({
  OpenAIModel: vi.fn().mockImplementation(() => ({ kind: "openai" })),
}));
vi.mock("@strands-agents/sdk/models/vercel", () => ({
  VercelModel: vi.fn().mockImplementation(() => ({ kind: "vercel" })),
}));
vi.mock("ai-sdk-ollama", () => ({
  createOllama: vi.fn(),
}));

const mockedOpenAIModel = vi.mocked(OpenAIModel);
const mockedVercelModel = vi.mocked(VercelModel);
const mockedCreateOllama = vi.mocked(createOllama);

describe("createModelProvider", () => {
  beforeEach(() => {
    mockedOpenAIModel.mockClear();
    mockedVercelModel.mockClear();
    mockedCreateOllama.mockClear();
  });

  describe("openai provider", () => {
    it("omits temperature when llmBaseUrl is not set", () => {
      createModelProvider(ProviderType.OPENAI, "gpt-4o", { temperature: 0.1 });

      expect(mockedOpenAIModel).toHaveBeenCalledWith({ api: "chat", modelId: "gpt-4o" });
    });

    it("sends temperature and clientConfig.baseURL when llmBaseUrl is set", () => {
      createModelProvider(ProviderType.OPENAI, "gpt-4o", {
        temperature: 0.1,
        llmBaseUrl: "http://localhost:11434/v1",
      });

      expect(mockedOpenAIModel).toHaveBeenCalledWith({
        api: "chat",
        modelId: "gpt-4o",
        clientConfig: { baseURL: "http://localhost:11434/v1" },
        temperature: 0.1,
      });
    });

    it("includes maxTokens and frequencyPenalty even without llmBaseUrl", () => {
      createModelProvider(ProviderType.OPENAI, "gpt-4o", {
        temperature: 0.1,
        maxTokens: 2048,
        frequencyPenalty: 0.5,
      });

      expect(mockedOpenAIModel).toHaveBeenCalledWith({
        api: "chat",
        modelId: "gpt-4o",
        maxTokens: 2048,
        frequencyPenalty: 0.5,
      });
    });

    it("includes maxTokens and frequencyPenalty alongside temperature when llmBaseUrl is set", () => {
      createModelProvider(ProviderType.OPENAI, "gpt-4o", {
        temperature: 0.1,
        llmBaseUrl: "http://localhost:11434/v1",
        maxTokens: 2048,
        frequencyPenalty: 0.5,
      });

      expect(mockedOpenAIModel).toHaveBeenCalledWith({
        api: "chat",
        modelId: "gpt-4o",
        clientConfig: { baseURL: "http://localhost:11434/v1" },
        temperature: 0.1,
        maxTokens: 2048,
        frequencyPenalty: 0.5,
      });
    });
  });

  describe("ollama provider", () => {
    it("defaults the host to http://localhost:11434 when llmBaseUrl is unset", () => {
      const providerFn = vi.fn().mockReturnValue({ kind: "ollama-language-model" });
      mockedCreateOllama.mockReturnValue(providerFn as never);

      createModelProvider(ProviderType.OLLAMA, "gpt-oss:120b", { temperature: 0.1 });

      expect(mockedCreateOllama).toHaveBeenCalledWith({ baseURL: "http://localhost:11434" });
      expect(providerFn).toHaveBeenCalledWith("gpt-oss:120b");
      expect(mockedVercelModel).toHaveBeenCalledWith({
        provider: { kind: "ollama-language-model" },
        temperature: 0.1,
      });
    });

    it("strips a trailing /v1 suffix from llmBaseUrl", () => {
      const providerFn = vi.fn().mockReturnValue({ kind: "ollama-language-model" });
      mockedCreateOllama.mockReturnValue(providerFn as never);

      createModelProvider(ProviderType.OLLAMA, "gpt-oss:120b", {
        temperature: 0.1,
        llmBaseUrl: "http://ollama-host:11434/v1",
      });

      expect(mockedCreateOllama).toHaveBeenCalledWith({ baseURL: "http://ollama-host:11434" });
    });

    it("keeps a llmBaseUrl that does not end in /v1 untouched", () => {
      const providerFn = vi.fn().mockReturnValue({ kind: "ollama-language-model" });
      mockedCreateOllama.mockReturnValue(providerFn as never);

      createModelProvider(ProviderType.OLLAMA, "gpt-oss:120b", {
        temperature: 0.1,
        llmBaseUrl: "http://ollama-host:11434/",
      });

      expect(mockedCreateOllama).toHaveBeenCalledWith({ baseURL: "http://ollama-host:11434/" });
    });

    it("includes maxTokens when set", () => {
      const providerFn = vi.fn().mockReturnValue({ kind: "ollama-language-model" });
      mockedCreateOllama.mockReturnValue(providerFn as never);

      createModelProvider(ProviderType.OLLAMA, "gpt-oss:120b", {
        temperature: 0.1,
        maxTokens: 2048,
      });

      expect(mockedVercelModel).toHaveBeenCalledWith({
        provider: { kind: "ollama-language-model" },
        temperature: 0.1,
        maxTokens: 2048,
      });
    });

    it("ignores frequencyPenalty and logs a warning", () => {
      const providerFn = vi.fn().mockReturnValue({ kind: "ollama-language-model" });
      mockedCreateOllama.mockReturnValue(providerFn as never);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      createModelProvider(ProviderType.OLLAMA, "gpt-oss:120b", {
        temperature: 0.1,
        frequencyPenalty: 0.5,
      });

      expect(mockedVercelModel).toHaveBeenCalledWith({
        provider: { kind: "ollama-language-model" },
        temperature: 0.1,
      });
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });
  });

  it("throws for an unsupported provider type", () => {
    expect(() =>
      createModelProvider("bedrock" as ProviderType, "gpt-4o", { temperature: 0.1 }),
    ).toThrow(/Unsupported provider type/);
  });
});
