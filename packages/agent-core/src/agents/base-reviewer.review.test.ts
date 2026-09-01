import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAgentCtor, mockInvoke, mockCreateModelProvider, mockCreateGithubMcpClient } =
  vi.hoisted(() => {
    const mockInvoke = vi.fn();
    const mockAgentCtor = vi.fn(function (this: unknown, config: unknown) {
      return {
        __config: config,
        invoke: mockInvoke,
      };
    });
    const mockCreateModelProvider = vi.fn().mockReturnValue({ __model: true });
    const mockCreateGithubMcpClient = vi.fn().mockImplementation(() => ({
      __ownedMcpClient: true,
      disconnect: vi.fn().mockResolvedValue(undefined),
    }));
    return { mockAgentCtor, mockInvoke, mockCreateModelProvider, mockCreateGithubMcpClient };
  });

vi.mock("@strands-agents/sdk", () => ({
  Agent: mockAgentCtor,
}));

vi.mock("@strands-agents/sdk/vended-tools/http-request", () => ({
  httpRequest: { __tool: "httpRequest" },
}));

vi.mock("./model-provider-factory.js", async () => {
  const actual = await vi.importActual<typeof import("./model-provider-factory.js")>(
    "./model-provider-factory.js",
  );
  return {
    ...actual,
    createModelProvider: mockCreateModelProvider,
  };
});

vi.mock("../tools/github-mcp.js", async () => {
  const actual =
    await vi.importActual<typeof import("../tools/github-mcp.js")>("../tools/github-mcp.js");
  return {
    ...actual,
    createGithubMcpClient: mockCreateGithubMcpClient,
  };
});

vi.mock("../tools/tool-result-sanitizer.js", () => ({
  OllamaUnsupportedContentSanitizer: vi.fn(function (this: unknown) {
    return { __plugin: "ollama-sanitizer" };
  }),
}));

vi.mock("../skills/agent-skills-factory.js", async () => {
  const actual = await vi.importActual<typeof import("../skills/agent-skills-factory.js")>(
    "../skills/agent-skills-factory.js",
  );
  return {
    ...actual,
    createAgentSkills: vi.fn(function (this: unknown) {
      return { __plugin: "agent-skills" };
    }),
  };
});

vi.mock("../tools/file-read-tool.js", () => ({
  createFileReadTool: vi.fn().mockReturnValue({ __tool: "file_read" }),
}));

const { ReviewAgent, LLMReviewAgent, buildPrompt, composeSystemPrompt } = await import(
  "./base-reviewer.js"
);
const { StructuredOutputMissingError } = await import("./exceptions.js");
const { ProviderType } = await import("./model-provider-factory.js");
const { AgentSkillType } = await import("../skills/agent-skills-factory.js");
const { GITHUB_MCP_URL } = await import("../tools/github-mcp.js");
const { OllamaUnsupportedContentSanitizer } = await import("../tools/tool-result-sanitizer.js");
const { createAgentSkills } = await import("../skills/agent-skills-factory.js");
const { createFileReadTool } = await import("../tools/file-read-tool.js");
const { ProjectType, ReviewPerspective, ReviewOutputSchema } = await import("../models/review.js");

type ReviewContext = import("../models/review.js").ReviewContext;
type ReviewerConfig = import("./base-reviewer.js").ReviewerConfig;

class StubReviewer extends LLMReviewAgent {
  static readonly reviewerId = "stub-technical";
  static readonly perspective = ReviewPerspective.enum.TECHNICAL;
  static readonly projectTypes = new Set([ProjectType.enum.REACT_TS]);
  protected readonly systemPrompt = "You are a stub reviewer.";
}

class NoMcpReviewer extends LLMReviewAgent {
  static readonly reviewerId = "no-mcp-technical";
  static readonly perspective = ReviewPerspective.enum.TECHNICAL;
  static readonly projectTypes = new Set([ProjectType.enum.REACT_TS]);
  protected readonly systemPrompt = "You are a stub reviewer.";
  protected readonly usesGithubMcp = false;
}

class UrlFetchReviewer extends LLMReviewAgent {
  static readonly reviewerId = "url-fetch-technical";
  static readonly perspective = ReviewPerspective.enum.SECURITY;
  static readonly projectTypes = new Set([ProjectType.enum.REACT_TS]);
  protected readonly systemPrompt = "You are a stub reviewer.";
  protected readonly usesUrlFetch = true;
}

class SkillsReviewer extends LLMReviewAgent {
  static readonly reviewerId = "skills-technical";
  static readonly perspective = ReviewPerspective.enum.TECHNICAL;
  static readonly projectTypes = new Set([ProjectType.enum.REACT_TS]);
  protected readonly systemPrompt = "You are a stub reviewer.";
  protected readonly skillType = AgentSkillType.REACT_REVIEW;
}

function makeContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    prInfo: {
      repositoryInfo: { owner: "octocat", repository: "hello" },
      projectSummary: "A demo repo",
      prInfo: {
        title: "Add feature",
        prNumber: 42,
        body: "Some body",
        labels: [],
        fileChanges: [],
      },
      dependencyFiles: [],
      manifestContents: {},
    },
    ...overrides,
  };
}

function baseConfig(overrides: Partial<ReviewerConfig> = {}): ReviewerConfig {
  return { githubToken: "gh-token", ...overrides };
}

describe("ReviewAgent", () => {
  it("stores the config passed to its constructor", () => {
    const config = baseConfig();
    const reviewer = new StubReviewer(config);
    expect(reviewer).toBeInstanceOf(ReviewAgent);
  });
});

describe("LLMReviewAgent.review", () => {
  beforeEach(() => {
    mockAgentCtor.mockClear();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      structuredOutput: { summary: "looks fine", findings: [] },
      stopReason: "endTurn",
    });
    mockCreateModelProvider.mockClear();
    mockCreateGithubMcpClient.mockClear();
    vi.mocked(createAgentSkills).mockClear();
    vi.mocked(createFileReadTool).mockClear();
    vi.mocked(OllamaUnsupportedContentSanitizer).mockClear();
  });

  it("uses the configured model id, default provider, and hardcoded temperature", async () => {
    const reviewer = new StubReviewer(baseConfig());
    await reviewer.review(makeContext());

    expect(mockCreateModelProvider).toHaveBeenCalledWith(
      ProviderType.OPENAI,
      "gpt-4o",
      expect.objectContaining({ temperature: 0.1 }),
    );
  });

  it("passes maxTokens and frequencyPenalty through to the model provider", async () => {
    const reviewer = new StubReviewer(
      baseConfig({ maxTokens: 500, frequencyPenalty: 0.5, modelId: "gpt-4o-mini" }),
    );
    await reviewer.review(makeContext());

    expect(mockCreateModelProvider).toHaveBeenCalledWith(
      ProviderType.OPENAI,
      "gpt-4o-mini",
      expect.objectContaining({ maxTokens: 500, frequencyPenalty: 0.5 }),
    );
  });

  it("passes limits.turns to invoke(), not to the Agent constructor", async () => {
    const reviewer = new StubReviewer(baseConfig({ maxAgentTurns: 10 }));
    await reviewer.review(makeContext());

    expect(mockAgentCtor).toHaveBeenCalledTimes(1);
    const agentConfig = mockAgentCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(agentConfig.limits).toBeUndefined();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [, invokeOptions] = mockInvoke.mock.calls[0] as [unknown, { limits?: unknown }];
    expect(invokeOptions.limits).toEqual({ turns: 10 });
  });

  it("defaults limits.turns to 30 when maxAgentTurns is not set", async () => {
    const reviewer = new StubReviewer(baseConfig());
    await reviewer.review(makeContext());

    const [, invokeOptions] = mockInvoke.mock.calls[0] as [unknown, { limits?: unknown }];
    expect(invokeOptions.limits).toEqual({ turns: 30 });
  });

  it("passes the ReviewOutput schema and composed system prompt", async () => {
    const reviewer = new StubReviewer(baseConfig());
    await reviewer.review(makeContext());

    const [, invokeOptions] = mockInvoke.mock.calls[0] as [
      unknown,
      { structuredOutputSchema?: unknown },
    ];
    expect(invokeOptions.structuredOutputSchema).toBe(ReviewOutputSchema);

    const agentConfig = mockAgentCtor.mock.calls[0]?.[0] as { systemPrompt?: string };
    expect(agentConfig.systemPrompt).toBe(composeSystemPrompt("You are a stub reviewer."));

    const [prompt] = mockInvoke.mock.calls[0] as [string];
    expect(prompt).toBe(buildPrompt(makeContext()));
  });

  it("creates its own MCP client when no shared client is provided, and disconnects it in finally", async () => {
    const reviewer = new StubReviewer(baseConfig());
    await reviewer.review(makeContext());

    expect(mockCreateGithubMcpClient).toHaveBeenCalledTimes(1);
    const ownedClient = mockCreateGithubMcpClient.mock.results[0]?.value as {
      disconnect: ReturnType<typeof vi.fn>;
    };
    expect(ownedClient.disconnect).toHaveBeenCalledTimes(1);

    const agentConfig = mockAgentCtor.mock.calls[0]?.[0] as { tools: unknown[] };
    expect(agentConfig.tools).toContain(ownedClient);
  });

  it("forwards ReviewerConfig MCP fields to createGithubMcpClient", async () => {
    const reviewer = new StubReviewer(
      baseConfig({
        mcpUrl: "https://example.test/mcp",
        mcpStartupRetryAttempts: 5,
        mcpStartupRetryBackoffSeconds: 2,
      }),
    );
    await reviewer.review(makeContext());

    expect(mockCreateGithubMcpClient).toHaveBeenCalledWith("gh-token", "https://example.test/mcp", {
      retryAttempts: 5,
      retryBackoffSeconds: 2,
    });
  });

  it("defaults the MCP url to GITHUB_MCP_URL and retry settings to 3/1", async () => {
    const reviewer = new StubReviewer(baseConfig());
    await reviewer.review(makeContext());

    expect(mockCreateGithubMcpClient).toHaveBeenCalledWith("gh-token", GITHUB_MCP_URL, {
      retryAttempts: 3,
      retryBackoffSeconds: 1,
    });
  });

  it("reuses a shared MCP client and never disconnects it", async () => {
    const sharedMcpClient = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReviewContext["sharedMcpClient"];
    const reviewer = new StubReviewer(baseConfig());
    await reviewer.review(makeContext({ sharedMcpClient }));

    expect(mockCreateGithubMcpClient).not.toHaveBeenCalled();
    expect(sharedMcpClient?.disconnect).not.toHaveBeenCalled();

    const agentConfig = mockAgentCtor.mock.calls[0]?.[0] as { tools: unknown[] };
    expect(agentConfig.tools).toContain(sharedMcpClient);
  });

  it("still disconnects an owned MCP client when invoke() throws", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    const reviewer = new StubReviewer(baseConfig());

    await expect(reviewer.review(makeContext())).rejects.toThrow("boom");

    const ownedClient = mockCreateGithubMcpClient.mock.results[0]?.value as {
      disconnect: ReturnType<typeof vi.fn>;
    };
    expect(ownedClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it("skips MCP wiring entirely when usesGithubMcp is false", async () => {
    const reviewer = new NoMcpReviewer(baseConfig());
    await reviewer.review(makeContext());

    expect(mockCreateGithubMcpClient).not.toHaveBeenCalled();
    const agentConfig = mockAgentCtor.mock.calls[0]?.[0] as { tools: unknown[] };
    expect(agentConfig.tools).toEqual([]);
  });

  it("adds the vended httpRequest tool when usesUrlFetch is true", async () => {
    const reviewer = new UrlFetchReviewer(baseConfig());
    await reviewer.review(makeContext());

    const agentConfig = mockAgentCtor.mock.calls[0]?.[0] as { tools: unknown[] };
    expect(agentConfig.tools).toContainEqual({ __tool: "httpRequest" });
  });

  it("wires the file-read tool and AgentSkills plugin when skillType is set", async () => {
    const reviewer = new SkillsReviewer(baseConfig());
    await reviewer.review(makeContext());

    expect(createFileReadTool).toHaveBeenCalledTimes(1);
    expect(createAgentSkills).toHaveBeenCalledWith(AgentSkillType.REACT_REVIEW);

    const agentConfig = mockAgentCtor.mock.calls[0]?.[0] as {
      tools: unknown[];
      plugins: unknown[];
    };
    expect(agentConfig.tools).toContainEqual({ __tool: "file_read" });
    expect(agentConfig.plugins).toContainEqual({ __plugin: "agent-skills" });
  });

  it("does not wire skills tooling when skillType is NONE", async () => {
    const reviewer = new StubReviewer(baseConfig());
    await reviewer.review(makeContext());

    expect(createFileReadTool).not.toHaveBeenCalled();
    expect(createAgentSkills).not.toHaveBeenCalled();
  });

  it("adds the Ollama sanitizer plugin only when providerType is ollama", async () => {
    const reviewer = new StubReviewer(baseConfig({ providerType: ProviderType.OLLAMA }));
    await reviewer.review(makeContext());

    expect(OllamaUnsupportedContentSanitizer).toHaveBeenCalledTimes(1);
    const agentConfig = mockAgentCtor.mock.calls[0]?.[0] as { plugins: unknown[] };
    expect(agentConfig.plugins).toContainEqual({ __plugin: "ollama-sanitizer" });
  });

  it("adds no Ollama plugin for the default (openai) provider", async () => {
    const reviewer = new StubReviewer(baseConfig());
    await reviewer.review(makeContext());

    expect(OllamaUnsupportedContentSanitizer).not.toHaveBeenCalled();
  });

  it("throws StructuredOutputMissingError when structuredOutput is undefined", async () => {
    mockInvoke.mockResolvedValueOnce({ structuredOutput: undefined, stopReason: "limitTurns" });
    const reviewer = new StubReviewer(baseConfig());

    await expect(reviewer.review(makeContext())).rejects.toBeInstanceOf(
      StructuredOutputMissingError,
    );
  });

  it("still disconnects an owned MCP client when structuredOutput is missing", async () => {
    mockInvoke.mockResolvedValueOnce({ structuredOutput: undefined, stopReason: "limitTurns" });
    const reviewer = new StubReviewer(baseConfig());

    await expect(reviewer.review(makeContext())).rejects.toThrow();

    const ownedClient = mockCreateGithubMcpClient.mock.results[0]?.value as {
      disconnect: ReturnType<typeof vi.fn>;
    };
    expect(ownedClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it("wraps the structured output with reviewer identity and the given project type", async () => {
    mockInvoke.mockResolvedValueOnce({
      structuredOutput: { summary: "all good", findings: [] },
      stopReason: "endTurn",
    });
    const reviewer = new StubReviewer(baseConfig());

    const result = await reviewer.review(makeContext(), ProjectType.enum.REACT_TS);

    expect(result).toEqual({
      reviewerId: "stub-technical",
      perspective: ReviewPerspective.enum.TECHNICAL,
      projectType: ProjectType.enum.REACT_TS,
      output: { summary: "all good", findings: [] },
    });
  });

  it("defaults projectType to null when not given", async () => {
    const reviewer = new StubReviewer(baseConfig());
    const result = await reviewer.review(makeContext());
    expect(result.projectType).toBeNull();
  });
});
