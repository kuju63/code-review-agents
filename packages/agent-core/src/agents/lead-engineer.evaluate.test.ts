import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAgentCtor, mockInvoke, mockCreateModelProvider } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockAgentCtor = vi.fn().mockImplementation((config: unknown) => ({
    __config: config,
    invoke: mockInvoke,
  }));
  const mockCreateModelProvider = vi.fn().mockReturnValue({ __model: true });
  return { mockAgentCtor, mockInvoke, mockCreateModelProvider };
});

vi.mock("@strands-agents/sdk", () => ({
  Agent: mockAgentCtor,
}));

vi.mock("./model-provider-factory.js", async () => {
  const actual = await vi.importActual<typeof import("./model-provider-factory.js")>(
    "./model-provider-factory.js",
  );
  return { ...actual, createModelProvider: mockCreateModelProvider };
});

const { LeadEngineerAgent } = await import("./lead-engineer.js");
const { StructuredOutputMissingError } = await import("./exceptions.js");
const { ProviderType } = await import("./model-provider-factory.js");
const { ProjectType, ReviewPerspective, ReviewPriority } = await import("../models/review.js");
const { DecisionVerdict, FindingImpact, FindingPriority, FindingSeverity } = await import(
  "../models/lead-engineer.js"
);

type ReviewerConfig = import("./base-reviewer.js").ReviewerConfig;
type ReviewReport = import("../models/review.js").ReviewReport;

function makeReport(): ReviewReport {
  return {
    results: [
      {
        reviewerId: "react-technical",
        perspective: ReviewPerspective.enum.TECHNICAL,
        projectType: ProjectType.enum.REACT_TS,
        output: {
          summary: "One issue found",
          findings: [
            {
              filePath: "src/a.ts",
              line: 10,
              comment: "Missing null check",
              context: null,
              proposedFix: null,
              priority: ReviewPriority.enum.HIGH,
            },
          ],
        },
      },
    ],
    errors: [
      {
        reviewerId: "security",
        perspective: ReviewPerspective.enum.SECURITY,
        message: "timed out",
      },
    ],
  };
}

const CONFIG: ReviewerConfig = { githubToken: "unused-by-this-agent" };

beforeEach(() => {
  mockInvoke.mockReset();
  mockAgentCtor.mockClear();
  mockCreateModelProvider.mockClear();
});

describe("LeadEngineerAgent.evaluate", () => {
  it("forbids speculation and requires a decision per finding in the system prompt", () => {
    const agent = new LeadEngineerAgent(CONFIG);
    expect(agent.systemPrompt).toMatch(/do not introduce/i);
    expect(agent.systemPrompt).toMatch(/speculate/i);
  });

  it("passes an empty tools array -- no GitHub MCP tools", async () => {
    mockInvoke.mockResolvedValue({
      structuredOutput: { overallSummary: "ok", decisions: [] },
      stopReason: "endTurn",
    });
    const agent = new LeadEngineerAgent(CONFIG);
    await agent.evaluate(makeReport());
    expect(mockAgentCtor).toHaveBeenCalledWith(expect.objectContaining({ tools: [] }));
  });

  it("requests LeadEngineerOutputSchema as the structured output", async () => {
    mockInvoke.mockResolvedValue({
      structuredOutput: { overallSummary: "ok", decisions: [] },
      stopReason: "endTurn",
    });
    const agent = new LeadEngineerAgent(CONFIG);
    await agent.evaluate(makeReport());
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ structuredOutputSchema: expect.anything() }),
    );
  });

  it("defaults maxAgentTurns to 30 when unset", async () => {
    mockInvoke.mockResolvedValue({
      structuredOutput: { overallSummary: "ok", decisions: [] },
      stopReason: "endTurn",
    });
    const agent = new LeadEngineerAgent(CONFIG);
    await agent.evaluate(makeReport());
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ limits: { turns: 30 } }),
    );
  });

  it("forwards a custom maxAgentTurns", async () => {
    mockInvoke.mockResolvedValue({
      structuredOutput: { overallSummary: "ok", decisions: [] },
      stopReason: "endTurn",
    });
    const agent = new LeadEngineerAgent({ ...CONFIG, maxAgentTurns: 5 });
    await agent.evaluate(makeReport());
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ limits: { turns: 5 } }),
    );
  });

  it("uses temperature 0.3 regardless of config, unlike reviewers' 0.1", async () => {
    mockInvoke.mockResolvedValue({
      structuredOutput: { overallSummary: "ok", decisions: [] },
      stopReason: "endTurn",
    });
    const agent = new LeadEngineerAgent(CONFIG);
    await agent.evaluate(makeReport());
    expect(mockCreateModelProvider).toHaveBeenCalledWith(
      ProviderType.OPENAI,
      "gpt-4o",
      expect.objectContaining({ temperature: 0.3 }),
    );
  });

  it("forwards modelId, llmBaseUrl, maxTokens, and frequencyPenalty to the model provider", async () => {
    mockInvoke.mockResolvedValue({
      structuredOutput: { overallSummary: "ok", decisions: [] },
      stopReason: "endTurn",
    });
    const agent = new LeadEngineerAgent({
      ...CONFIG,
      modelId: "gpt-4o-mini",
      llmBaseUrl: "https://example.test/v1",
      maxTokens: 2048,
      frequencyPenalty: 0.5,
    });
    await agent.evaluate(makeReport());
    expect(mockCreateModelProvider).toHaveBeenCalledWith(
      ProviderType.OPENAI,
      "gpt-4o-mini",
      expect.objectContaining({
        llmBaseUrl: "https://example.test/v1",
        maxTokens: 2048,
        frequencyPenalty: 0.5,
      }),
    );
  });

  it("forwards an explicit Ollama providerType", async () => {
    mockInvoke.mockResolvedValue({
      structuredOutput: { overallSummary: "ok", decisions: [] },
      stopReason: "endTurn",
    });
    const agent = new LeadEngineerAgent({ ...CONFIG, providerType: ProviderType.OLLAMA });
    await agent.evaluate(makeReport());
    expect(mockCreateModelProvider).toHaveBeenCalledWith(
      ProviderType.OLLAMA,
      "gpt-4o",
      expect.anything(),
    );
  });

  it("raises StructuredOutputMissingError when structuredOutput is undefined", async () => {
    mockInvoke.mockResolvedValue({ structuredOutput: undefined, stopReason: "limitTurns" });
    const agent = new LeadEngineerAgent(CONFIG);
    await expect(agent.evaluate(makeReport())).rejects.toThrow(StructuredOutputMissingError);
    await expect(agent.evaluate(makeReport())).rejects.toThrow(/LeadEngineerAgent/);
  });

  it("returns a report resolving decisions by index and forwarding reviewer errors unchanged", async () => {
    mockInvoke.mockResolvedValue({
      structuredOutput: {
        overallSummary: "Reviewed one finding",
        decisions: [
          {
            findingIndex: 1,
            verdict: DecisionVerdict.enum.ACCEPT,
            reason: "valid concern",
            impact: "could crash",
            severity: FindingSeverity.enum.HIGH,
            impactCategory: FindingImpact.enum.CORRECTNESS,
            finalPriority: FindingPriority.enum.HIGH,
          },
        ],
      },
      stopReason: "endTurn",
    });
    const report = makeReport();
    const agent = new LeadEngineerAgent(CONFIG);
    const result = await agent.evaluate(report);

    expect(result.overallSummary).toBe("Reviewed one finding");
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.finding).toBe(report.results[0]?.output.findings[0]);
    expect(result.reviewerErrors).toBe(report.errors);
  });
});
