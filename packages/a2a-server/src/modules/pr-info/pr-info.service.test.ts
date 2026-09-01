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

  it.each(["gho_secret", "ghu_secret", "ghs_secret", "ghr_secret"])(
    "redacts standalone GitHub token %s",
    (token) => {
      const sanitized = sanitizeError(new Error(`request failed: ${token}`));

      expect(sanitized).toContain("[REDACTED]");
      expect(sanitized).not.toContain(token);
    },
  );

  it("preserves existing credential redaction", () => {
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

    const first = await store.create("owner-1");
    const second = await store.create("owner-1");

    expect(first.status).toBe("submitted");
    expect(first.id).not.toBe("");
    expect(first.id).not.toBe(second.id);
  });

  it("returns tasks only to their owner", async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create("owner-1");

    await expect(store.get(task.id, "owner-1")).resolves.toEqual(task);
    await expect(store.get(task.id, "owner-2")).resolves.toBeNull();
  });

  it("deletes submitted or working tasks after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryTaskStore({ ttlSeconds: 1 });
      const task = await store.create("owner-1");
      await store.setWorking(task.id);

      await vi.advanceTimersByTimeAsync(1000);

      await expect(store.get(task.id, "owner-1")).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the TTL after a terminal transition", async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryTaskStore({ ttlSeconds: 1 });
      const task = await store.create("owner-1");
      await vi.advanceTimersByTimeAsync(500);
      await store.setCompleted(task.id, []);
      await vi.advanceTimersByTimeAsync(500);

      await expect(store.get(task.id, "owner-1")).resolves.not.toBeNull();

      await vi.advanceTimersByTimeAsync(500);
      await expect(store.get(task.id, "owner-1")).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates known tasks and ignores unknown ids", async () => {
    const store = new InMemoryTaskStore();
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

describe("PR Info service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockedPRInfoCollector.mockImplementation(function (this: unknown) {
      return { collect: vi.fn(async () => prInfoResult) } as unknown as PRInfoCollector;
    });
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

    const response = await service.sendTask(request, "ghp_testtoken", "owner-1");
    await service.runPendingTasks();

    const task = await store.get(response.task.id, "owner-1");
    expect(response.task.status).toBe("submitted");
    expect(task?.status).toBe("completed");
    expect(task?.message?.parts).toEqual([{ kind: "data", data: prInfoResult }]);
  });

  it("does not retain settled default-scheduled tasks", async () => {
    const store = new InMemoryTaskStore();
    const service = createPrInfoService({ store });

    const first = await service.sendTask(request, "ghp_testtoken", "owner-1");
    const second = await service.sendTask(request, "ghp_testtoken", "owner-1");
    await vi.waitFor(async () => {
      expect((await store.get(first.task.id, "owner-1"))?.status).toBe("completed");
      expect((await store.get(second.task.id, "owner-1"))?.status).toBe("completed");
    });
    const promiseAll = vi.spyOn(Promise, "all");

    await service.runPendingTasks();

    expect(promiseAll).toHaveBeenCalledWith([]);
    promiseAll.mockRestore();
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

    await service.sendTask(request, "ghp_testtoken", "owner-1");
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

    await expect(service.getTask("nonexistent-id", "owner-1")).resolves.toBeNull();
  });

  it.each(["gho_secret", "ghu_secret", "ghs_secret", "ghr_secret"])(
    "removes %s from stored failures and logs",
    async (token) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      MockedPRInfoCollector.mockImplementation(function (this: unknown) {
        return {
          collect: vi.fn(async () => {
            throw new Error(`request failed: ${token}`);
          }),
        } as unknown as PRInfoCollector;
      });
      const store = new InMemoryTaskStore();
      const service = createPrInfoService({ store });

      const response = await service.sendTask(request, "ghp_testtoken", "owner-1");
      await service.runPendingTasks();

      const task = await store.get(response.task.id, "owner-1");
      expect(task?.status).toBe("failed");
      expect(task?.error).toBe("request failed: [REDACTED]");
      expect(task?.error).not.toContain(token);
      expect(warn).toHaveBeenCalledWith(expect.not.stringContaining(token));
      warn.mockRestore();
    },
  );
});
