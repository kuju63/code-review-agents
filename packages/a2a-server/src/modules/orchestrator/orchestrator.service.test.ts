import type {
  LeadEngineerReport,
  PRInfoResult,
  ReviewContext,
  ReviewReport,
} from "@code-review-agent/agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  createOrchestratorService,
  extractData,
  InMemoryOrchestratorTaskStore,
  type LeadEngineerAgentClass,
  type OrchestratorAgentClass,
  type PRInfoCollectorClass,
  sanitizeError,
} from "./orchestrator.service.js";

const prInfo: PRInfoResult = {
  repositoryInfo: { owner: "octocat", repository: "hello" },
  projectSummary: "A project.",
  prInfo: { title: "Fix", prNumber: 1, body: "", labels: [], fileChanges: [] },
  dependencyFiles: [],
  manifestContents: {},
};

const reviewReport: ReviewReport = {
  results: [],
  errors: [],
};

const leadReport: LeadEngineerReport = {
  overallSummary: "All clear.",
  decisions: [],
  reviewerErrors: [],
};

const request = {
  message: {
    role: "user" as const,
    parts: [{ kind: "data" as const, data: { owner: "octocat", repo: "hello", prNumber: 1 } }],
  },
};

describe("Orchestrator service helpers", () => {
  it("extracts the first data part", () => {
    expect(
      extractData({
        role: "user",
        parts: [
          { kind: "text", text: "ignored" },
          { kind: "data", data: { key: "value" } },
        ],
      }),
    ).toEqual({ key: "value" });
  });

  it("returns an empty object when a message has no data part", () => {
    expect(extractData({ role: "user", parts: [{ kind: "text", text: "hello" }] })).toEqual({});
  });

  it("redacts credential-like strings in errors", () => {
    expect(sanitizeError(new Error("request failed: Bearer ghp_abc123xyz"))).toBe(
      "request failed: [REDACTED]",
    );
    expect(sanitizeError(new Error("auth error: github_pat_longtoken123abc"))).not.toContain(
      "github_pat_longtoken123abc",
    );
  });
});

describe("InMemoryOrchestratorTaskStore", () => {
  it("creates submitted tasks with unique ids", async () => {
    const store = new InMemoryOrchestratorTaskStore();

    const first = await store.create("owner-1");
    const second = await store.create("owner-1");

    expect(first.status).toBe("submitted");
    expect(first.id).not.toBe("");
    expect(first.id).not.toBe(second.id);
  });

  it("returns tasks only to their owner", async () => {
    const store = new InMemoryOrchestratorTaskStore();
    const task = await store.create("owner-1");

    await expect(store.get(task.id, "owner-1")).resolves.toEqual(task);
    await expect(store.get(task.id, "owner-2")).resolves.toBeNull();
  });

  it("updates known tasks and ignores unknown ids", async () => {
    const store = new InMemoryOrchestratorTaskStore();
    const task = await store.create("owner-1");

    await store.setWorking(task.id);
    expect((await store.get(task.id, "owner-1"))?.status).toBe("working");

    await store.setCompleted(task.id, [{ kind: "data", data: { result: "ok" } }]);
    const completed = await store.get(task.id, "owner-1");
    expect(completed?.status).toBe("completed");
    expect(completed?.message).toEqual({
      role: "agent",
      parts: [{ kind: "data", data: { result: "ok" } }],
    });

    await store.setFailed("missing", "error");
    expect(await store.get("missing", "owner-1")).toBeNull();
  });
});

describe("Orchestrator service", () => {
  function createFakes({
    collectorResult = prInfo,
    orchestratorResult = reviewReport,
    leadEngineerResult = leadReport,
    onCollectorConstruct = vi.fn(),
    onOrchestratorConstruct = vi.fn(),
    onLeadEngineerConstruct = vi.fn(),
  }: {
    collectorResult?: PRInfoResult;
    orchestratorResult?: ReviewReport;
    leadEngineerResult?: LeadEngineerReport;
    onCollectorConstruct?: ReturnType<typeof vi.fn>;
    onOrchestratorConstruct?: ReturnType<typeof vi.fn>;
    onLeadEngineerConstruct?: ReturnType<typeof vi.fn>;
  } = {}) {
    const collect = vi.fn<(owner: string, repo: string, prNumber: number) => Promise<PRInfoResult>>(
      async () => collectorResult,
    );
    const run = vi.fn<(context: ReviewContext) => Promise<ReviewReport>>(async (context) => {
      expect(context.prInfo).toEqual(collectorResult);
      return orchestratorResult;
    });
    const evaluate = vi.fn<(report: ReviewReport) => Promise<LeadEngineerReport>>(
      async (report) => {
        expect(report).toEqual(orchestratorResult);
        return leadEngineerResult;
      },
    );

    const collectorClass: PRInfoCollectorClass = class FakePRInfoCollector {
      constructor(config: ConstructorParameters<PRInfoCollectorClass>[0]) {
        onCollectorConstruct(config);
      }

      collect(owner: string, repo: string, prNumber: number): Promise<PRInfoResult> {
        return collect(owner, repo, prNumber);
      }
    };

    const orchestratorClass: OrchestratorAgentClass = class FakeReviewOrchestrator {
      constructor(config: ConstructorParameters<OrchestratorAgentClass>[0]) {
        onOrchestratorConstruct(config);
      }

      run(context: ReviewContext): Promise<ReviewReport> {
        return run(context);
      }
    };

    const leadEngineerClass: LeadEngineerAgentClass = class FakeLeadEngineerAgent {
      constructor(config: ConstructorParameters<LeadEngineerAgentClass>[0]) {
        onLeadEngineerConstruct(config);
      }

      evaluate(report: ReviewReport): Promise<LeadEngineerReport> {
        return evaluate(report);
      }
    };

    return {
      collectorClass,
      orchestratorClass,
      leadEngineerClass,
      collect,
      run,
      evaluate,
      onCollectorConstruct,
      onOrchestratorConstruct,
      onLeadEngineerConstruct,
    };
  }

  it("returns an AgentCard using existing schemas", () => {
    const service = createOrchestratorService();

    const card = service.getAgentCard();

    expect(card.name).toBe("Orchestrator");
    expect(card.url).toContain("/orchestrator");
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]?.inputSchema).toMatchObject({ required: ["owner", "repo", "prNumber"] });
    expect(card.skills[0]?.outputSchema.required).toEqual(
      expect.arrayContaining(["overallSummary"]),
    );
  });

  it("creates a submitted task and completes the full pipeline in the background", async () => {
    const fakes = createFakes();
    const store = new InMemoryOrchestratorTaskStore();
    const service = createOrchestratorService({
      store,
      collectorClass: fakes.collectorClass,
      orchestratorClass: fakes.orchestratorClass,
      leadEngineerClass: fakes.leadEngineerClass,
    });

    const response = await service.sendTask(request, "ghp_testtoken", "owner-1");
    await service.runPendingTasks();

    const task = await store.get(response.task.id, "owner-1");
    expect(response.task.status).toBe("submitted");
    expect(task?.status).toBe("completed");
    expect(task?.message?.parts).toEqual([{ kind: "data", data: leadReport }]);
    expect(fakes.collect).toHaveBeenCalledWith("octocat", "hello", 1);
    expect(fakes.run).toHaveBeenCalledOnce();
    expect(fakes.evaluate).toHaveBeenCalledWith(reviewReport);
  });

  it("passes runtime settings through the three-stage pipeline", async () => {
    const fakes = createFakes();
    const service = createOrchestratorService({
      collectorClass: fakes.collectorClass,
      orchestratorClass: fakes.orchestratorClass,
      leadEngineerClass: fakes.leadEngineerClass,
      settings: {
        modelId: "gpt-4o-mini",
        llmBaseUrl: "http://localhost:11434/v1",
        providerType: "ollama",
        maxAgentTurns: 7,
        maxTokens: 4096,
        frequencyPenalty: 0.2,
        reviewerTimeoutSeconds: 12,
        mcpStartupRetryAttempts: 7,
        mcpStartupRetryBackoffSeconds: 4.2,
      },
    });

    await service.sendTask(request, "ghp_testtoken", "owner-1");
    await service.runPendingTasks();

    expect(fakes.onCollectorConstruct).toHaveBeenCalledWith(
      expect.objectContaining({
        githubToken: "ghp_testtoken",
        modelId: "gpt-4o-mini",
        llmBaseUrl: "http://localhost:11434/v1",
        providerType: "ollama",
        maxAgentTurns: 7,
        mcpStartupRetryAttempts: 7,
        mcpStartupRetryBackoffSeconds: 4.2,
      }),
    );
    const reviewerConfig = fakes.onOrchestratorConstruct.mock.calls[0]?.[0];
    expect(reviewerConfig).toEqual(
      expect.objectContaining({
        githubToken: "ghp_testtoken",
        modelId: "gpt-4o-mini",
        llmBaseUrl: "http://localhost:11434/v1",
        providerType: "ollama",
        maxAgentTurns: 7,
        maxTokens: 4096,
        frequencyPenalty: 0.2,
        reviewerTimeoutSeconds: 12,
        mcpStartupRetryAttempts: 7,
        mcpStartupRetryBackoffSeconds: 4.2,
      }),
    );
    expect(fakes.onLeadEngineerConstruct).toHaveBeenCalledWith(reviewerConfig);
  });

  it("lets request modelId override the configured default", async () => {
    const fakes = createFakes();
    const service = createOrchestratorService({
      collectorClass: fakes.collectorClass,
      orchestratorClass: fakes.orchestratorClass,
      leadEngineerClass: fakes.leadEngineerClass,
      settings: { modelId: "configured-model" },
    });

    await service.sendTask(
      {
        message: {
          role: "user",
          parts: [
            {
              kind: "data",
              data: { owner: "octocat", repo: "hello", prNumber: 1, modelId: " request-model " },
            },
          ],
        },
      },
      "ghp_testtoken",
      "owner-1",
    );
    await service.runPendingTasks();

    expect(fakes.onOrchestratorConstruct).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "request-model" }),
    );
  });

  it("returns null for unknown task ids", async () => {
    const service = createOrchestratorService();

    await expect(service.getTask("nonexistent-id", "owner-1")).resolves.toBeNull();
  });

  it("stores sanitized failures on the task", async () => {
    const fakes = createFakes();
    const failingCollectorClass: PRInfoCollectorClass = class FailingPRInfoCollector {
      async collect(): Promise<PRInfoResult> {
        throw new Error("request failed: Bearer ghp_secret");
      }
    };
    const store = new InMemoryOrchestratorTaskStore();
    const service = createOrchestratorService({
      store,
      collectorClass: failingCollectorClass,
      orchestratorClass: fakes.orchestratorClass,
      leadEngineerClass: fakes.leadEngineerClass,
    });

    const response = await service.sendTask(request, "ghp_testtoken", "owner-1");
    await service.runPendingTasks();

    const task = await store.get(response.task.id, "owner-1");
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("request failed: [REDACTED]");
    expect(fakes.run).not.toHaveBeenCalled();
    expect(fakes.evaluate).not.toHaveBeenCalled();
  });
});
