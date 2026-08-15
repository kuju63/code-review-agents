import { PRInfoCollector } from "@code-review-agent/agent-core/agents/pr-info-collector.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrInfoService,
  DEFAULT_A2A_SERVER_SETTINGS,
  extractData,
  InMemoryTaskStore,
  sanitizeError,
} from "./pr-info.service.js";

vi.mock("@code-review-agent/agent-core/agents/pr-info-collector.js", () => ({
  PRInfoCollector: vi.fn(),
}));

const MockedPRInfoCollector = vi.mocked(PRInfoCollector);

const prInfoResult = {
  repositoryInfo: { owner: "octocat", repository: "hello" },
  projectSummary: "A project.",
  prInfo: { title: "Fix", prNumber: 1, body: "", labels: [], fileChanges: [] },
  dependencyFiles: [],
};

const request = {
  message: {
    role: "user" as const,
    parts: [{ kind: "data" as const, data: { owner: "octocat", repo: "hello", prNumber: 1 } }],
  },
};

describe("PR Info service helpers", () => {
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

describe("InMemoryTaskStore", () => {
  it("creates submitted tasks with unique ids", async () => {
    const store = new InMemoryTaskStore();

    const first = await store.create();
    const second = await store.create();

    expect(first.status).toBe("submitted");
    expect(first.id).not.toBe("");
    expect(first.id).not.toBe(second.id);
  });

  it("updates known tasks and ignores unknown ids", async () => {
    const store = new InMemoryTaskStore();
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

describe("PR Info service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockedPRInfoCollector.mockImplementation(
      () => ({ collect: vi.fn(async () => prInfoResult) }) as unknown as PRInfoCollector,
    );
  });

  it("returns an AgentCard using existing schemas", () => {
    const service = createPrInfoService();

    const card = service.getAgentCard();

    expect(card.name).toBe("PR Info Collector");
    expect(card.url).toContain("/pr-info-collector");
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]?.inputSchema).toMatchObject({ required: ["owner", "repo", "prNumber"] });
  });

  it("creates a submitted task and completes it in the background", async () => {
    const store = new InMemoryTaskStore();
    const service = createPrInfoService({ store });

    const response = await service.sendTask(request, "ghp_testtoken");
    await service.runPendingTasks();

    const task = await store.get(response.task.id);
    expect(response.task.status).toBe("submitted");
    expect(task?.status).toBe("completed");
    expect(task?.message?.parts).toEqual([{ kind: "data", data: prInfoResult }]);
  });

  it("passes runtime settings to the collector", async () => {
    const service = createPrInfoService({
      settings: {
        ...DEFAULT_A2A_SERVER_SETTINGS,
        modelId: "gpt-4o-mini",
        llmBaseUrl: "http://localhost:11434/v1",
        mcpStartupRetryAttempts: 7,
        mcpStartupRetryBackoffSeconds: 4.2,
      },
    });

    await service.sendTask(request, "ghp_testtoken");
    await service.runPendingTasks();

    expect(MockedPRInfoCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        githubToken: "ghp_testtoken",
        modelId: "gpt-4o-mini",
        llmBaseUrl: "http://localhost:11434/v1",
        mcpStartupRetryAttempts: 7,
        mcpStartupRetryBackoffSeconds: 4.2,
      }),
    );
  });

  it("returns null for unknown task ids", async () => {
    const service = createPrInfoService();

    await expect(service.getTask("nonexistent-id")).resolves.toBeNull();
  });

  it("stores sanitized failures on the task", async () => {
    MockedPRInfoCollector.mockImplementation(
      () =>
        ({
          collect: vi.fn(async () => {
            throw new Error("request failed: Bearer ghp_secret");
          }),
        }) as unknown as PRInfoCollector,
    );
    const store = new InMemoryTaskStore();
    const service = createPrInfoService({ store });

    const response = await service.sendTask(request, "ghp_testtoken");
    await service.runPendingTasks();

    const task = await store.get(response.task.id);
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("request failed: [REDACTED]");
  });
});
