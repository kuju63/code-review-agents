import type { LeadEngineerReport, ReviewReport } from "@code-review-agent/agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  createLeadEngineerService,
  extractData,
  InMemoryLeadEngineerTaskStore,
  type LeadEngineerAgentClass,
  sanitizeError,
} from "./lead-engineer.service.js";

const reviewReport: ReviewReport = {
  results: [],
  errors: [],
};

const request = {
  message: {
    role: "user" as const,
    parts: [{ kind: "data" as const, data: { reviewReport } }],
  },
};

function createFakeAgentClass(
  result: LeadEngineerReport,
  onConstruct = vi.fn(),
): LeadEngineerAgentClass {
  return class FakeLeadEngineerAgent {
    constructor(config: ConstructorParameters<LeadEngineerAgentClass>[0]) {
      onConstruct(config);
    }

    async evaluate(report: ReviewReport): Promise<LeadEngineerReport> {
      expect(report.results).toEqual([]);
      return result;
    }
  };
}

describe("Lead Engineer service helpers", () => {
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

describe("InMemoryLeadEngineerTaskStore", () => {
  it("creates submitted tasks with unique ids", async () => {
    const store = new InMemoryLeadEngineerTaskStore();

    const first = await store.create();
    const second = await store.create();

    expect(first.status).toBe("submitted");
    expect(first.id).not.toBe("");
    expect(first.id).not.toBe(second.id);
  });

  it("updates known tasks and ignores unknown ids", async () => {
    const store = new InMemoryLeadEngineerTaskStore();
    const task = await store.create();

    await store.setWorking(task.id);
    expect((await store.get(task.id))?.status).toBe("working");

    await store.setCompleted(task.id, [{ kind: "data", data: { result: "ok" } }]);
    const completed = await store.get(task.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.message).toEqual({
      role: "agent",
      parts: [{ kind: "data", data: { result: "ok" } }],
    });

    await store.setFailed("missing", "error");
    expect(await store.get("missing")).toBeNull();
  });
});

describe("Lead Engineer service", () => {
  const result: LeadEngineerReport = {
    overallSummary: "All clear.",
    decisions: [],
    reviewerErrors: [],
  };

  it("returns an AgentCard using existing schemas", () => {
    const service = createLeadEngineerService();

    const card = service.getAgentCard();

    expect(card.name).toBe("Lead Engineer");
    expect(card.url).toContain("/lead-engineer");
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]?.inputSchema).toMatchObject({ required: ["reviewReport"] });
    expect(card.skills[0]?.outputSchema.required).toEqual(
      expect.arrayContaining(["overallSummary"]),
    );
  });

  it("creates a submitted task and completes it in the background", async () => {
    const store = new InMemoryLeadEngineerTaskStore();
    const service = createLeadEngineerService({
      store,
      agentClass: createFakeAgentClass(result),
    });

    const response = await service.sendTask(request, "ghp_testtoken");
    await service.runPendingTasks();

    const task = await store.get(response.task.id);
    expect(response.task.status).toBe("submitted");
    expect(task?.status).toBe("completed");
    expect(task?.message?.parts).toEqual([{ kind: "data", data: result }]);
  });

  it("passes runtime settings to the lead engineer config", async () => {
    const onConstruct = vi.fn();
    const service = createLeadEngineerService({
      agentClass: createFakeAgentClass(result, onConstruct),
      settings: {
        modelId: "gpt-4o-mini",
        llmBaseUrl: "http://localhost:11434/v1",
        providerType: "ollama",
        maxAgentTurns: 7,
        maxTokens: 4096,
        frequencyPenalty: 0.2,
      },
    });

    await service.sendTask(request, "ghp_testtoken");
    await service.runPendingTasks();

    expect(onConstruct).toHaveBeenCalledWith(
      expect.objectContaining({
        githubToken: "ghp_testtoken",
        modelId: "gpt-4o-mini",
        llmBaseUrl: "http://localhost:11434/v1",
        providerType: "ollama",
        maxAgentTurns: 7,
        maxTokens: 4096,
        frequencyPenalty: 0.2,
      }),
    );
  });

  it("lets request modelId override the configured default", async () => {
    const onConstruct = vi.fn();
    const service = createLeadEngineerService({
      agentClass: createFakeAgentClass(result, onConstruct),
      settings: { modelId: "configured-model" },
    });

    await service.sendTask(
      {
        message: {
          role: "user",
          parts: [{ kind: "data", data: { reviewReport, modelId: "request-model" } }],
        },
      },
      "ghp_testtoken",
    );
    await service.runPendingTasks();

    expect(onConstruct).toHaveBeenCalledWith(expect.objectContaining({ modelId: "request-model" }));
  });

  it("returns null for unknown task ids", async () => {
    const service = createLeadEngineerService({ agentClass: createFakeAgentClass(result) });

    await expect(service.getTask("nonexistent-id")).resolves.toBeNull();
  });

  it("stores sanitized failures on the task", async () => {
    const agentClass: LeadEngineerAgentClass = class FailingLeadEngineerAgent {
      async evaluate(): Promise<LeadEngineerReport> {
        throw new Error("request failed: Bearer ghp_secret");
      }
    };
    const store = new InMemoryLeadEngineerTaskStore();
    const service = createLeadEngineerService({ store, agentClass });

    const response = await service.sendTask(request, "ghp_testtoken");
    await service.runPendingTasks();

    const task = await store.get(response.task.id);
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("request failed: [REDACTED]");
  });
});
