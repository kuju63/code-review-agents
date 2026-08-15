import type { ReviewContext, ReviewResult } from "@code-review-agent/agent-core";
import { describe, expect, it, vi } from "vitest";
import { createAngularReviewerService } from "./angular.service.js";
import { createReactReviewerService } from "./react.service.js";
import {
  extractData,
  InMemoryReviewerTaskStore,
  type ReviewerClass,
  type ReviewerServiceOptions,
  sanitizeError,
} from "./reviewer-runtime.js";
import { createSecurityReviewerService } from "./security.service.js";
import { createSvelteReviewerService } from "./svelte.service.js";
import { createVueReviewerService } from "./vue.service.js";

const prInfo = {
  repositoryInfo: { owner: "octocat", repository: "hello" },
  projectSummary: "A project.",
  prInfo: {
    title: "Fix",
    prNumber: 1,
    body: "",
    labels: [],
    fileChanges: [],
  },
  dependencyFiles: [],
};

const request = {
  message: {
    role: "user" as const,
    parts: [{ kind: "data" as const, data: { prInfo } }],
  },
};

type CreateTestReviewerService = (
  options?: ReviewerServiceOptions & { reviewerClass?: ReviewerClass },
) => ReturnType<typeof createReactReviewerService>;

const reviewers: readonly {
  name: string;
  path: string;
  createService: CreateTestReviewerService;
  reviewerId: string;
  perspective: "technical" | "security";
}[] = [
  {
    name: "React Reviewer",
    path: "react-reviewer",
    createService: createReactReviewerService as CreateTestReviewerService,
    reviewerId: "react-technical",
    perspective: "technical",
  },
  {
    name: "Angular Reviewer",
    path: "angular-reviewer",
    createService: createAngularReviewerService as CreateTestReviewerService,
    reviewerId: "angular-technical",
    perspective: "technical",
  },
  {
    name: "Vue Reviewer",
    path: "vue-reviewer",
    createService: createVueReviewerService as CreateTestReviewerService,
    reviewerId: "vue-technical",
    perspective: "technical",
  },
  {
    name: "Svelte Reviewer",
    path: "svelte-reviewer",
    createService: createSvelteReviewerService as CreateTestReviewerService,
    reviewerId: "svelte-technical",
    perspective: "technical",
  },
  {
    name: "Security Reviewer",
    path: "security-reviewer",
    createService: createSecurityReviewerService as CreateTestReviewerService,
    reviewerId: "security",
    perspective: "security",
  },
] as const;

function createFakeReviewerClass(
  result: ReviewResult,
  onConstruct = vi.fn(),
  onReview = vi.fn(),
): ReviewerClass {
  return class FakeReviewer {
    constructor(config: ConstructorParameters<ReviewerClass>[0]) {
      onConstruct(config);
    }

    async review(context: ReviewContext): Promise<ReviewResult> {
      onReview(context);
      return result;
    }
  };
}

describe("reviewer service helpers", () => {
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

  it("redacts credential-like strings in errors", () => {
    expect(sanitizeError(new Error("request failed: Bearer ghp_abc123xyz"))).toBe(
      "request failed: [REDACTED]",
    );
    expect(sanitizeError(new Error("auth error: github_pat_longtoken123abc"))).not.toContain(
      "github_pat_longtoken123abc",
    );
  });
});

describe("InMemoryReviewerTaskStore", () => {
  it("creates submitted tasks with unique ids", async () => {
    const store = new InMemoryReviewerTaskStore();

    const first = await store.create("owner-1");
    const second = await store.create("owner-1");

    expect(first.status).toBe("submitted");
    expect(first.id).not.toBe("");
    expect(first.id).not.toBe(second.id);
  });

  it("returns tasks only to their owner", async () => {
    const store = new InMemoryReviewerTaskStore();
    const task = await store.create("owner-1");

    await expect(store.get(task.id, "owner-1")).resolves.toEqual(task);
    await expect(store.get(task.id, "owner-2")).resolves.toBeNull();
  });

  it("deletes submitted or working tasks after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryReviewerTaskStore({ ttlSeconds: 1 });
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
      const store = new InMemoryReviewerTaskStore({ ttlSeconds: 1 });
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
    const store = new InMemoryReviewerTaskStore();
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

describe.each(reviewers)(
  "$name service",
  ({ name, path, createService, reviewerId, perspective }) => {
    const result: ReviewResult = {
      reviewerId,
      perspective,
      projectType: null,
      output: { summary: "Looks good.", findings: [] },
    };

    it("returns an AgentCard using existing schemas", () => {
      const service = createService();

      const card = service.getAgentCard();

      expect(card.name).toBe(name);
      expect(card.url).toContain(`/${path}`);
      expect(card.skills).toHaveLength(1);
      expect(card.skills[0]?.inputSchema).toMatchObject({ required: ["prInfo"] });
      expect(card.skills[0]?.outputSchema.required).toEqual(
        expect.arrayContaining(["reviewerId", "perspective", "output"]),
      );
    });

    it("creates a submitted task and completes it in the background", async () => {
      const store = new InMemoryReviewerTaskStore();
      const onReview = vi.fn();
      const service = createService({
        store,
        reviewerClass: createFakeReviewerClass(result, vi.fn(), onReview),
      });

      const response = await service.sendTask(request, "ghp_testtoken", "owner-1");
      await service.runPendingTasks();

      const task = await store.get(response.task.id, "owner-1");
      expect(response.task.status).toBe("submitted");
      expect(task?.status).toBe("completed");
      expect(task?.message?.parts).toEqual([{ kind: "data", data: result }]);
      expect(onReview).toHaveBeenCalledWith(
        expect.objectContaining({
          prInfo: expect.objectContaining({
            repositoryInfo: expect.objectContaining({ owner: "octocat" }),
          }),
        }),
      );
    });

    it("does not retain settled default-scheduled tasks", async () => {
      const store = new InMemoryReviewerTaskStore();
      const service = createService({
        store,
        reviewerClass: createFakeReviewerClass(result),
      });

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

    it("passes runtime settings to the reviewer config", async () => {
      const onConstruct = vi.fn();
      const service = createService({
        reviewerClass: createFakeReviewerClass(result, onConstruct),
        settings: {
          modelId: "gpt-4o-mini",
          llmBaseUrl: "http://localhost:11434/v1",
          mcpStartupRetryAttempts: 7,
          mcpStartupRetryBackoffSeconds: 4.2,
        },
      });

      await service.sendTask(request, "ghp_testtoken", "owner-1");
      await service.runPendingTasks();

      expect(onConstruct).toHaveBeenCalledWith(
        expect.objectContaining({
          githubToken: "ghp_testtoken",
          modelId: "gpt-4o-mini",
          llmBaseUrl: "http://localhost:11434/v1",
          mcpStartupRetryAttempts: 7,
          mcpStartupRetryBackoffSeconds: 4.2,
        }),
      );
    });

    it("uses the configured modelId when the request omits it", async () => {
      const onConstruct = vi.fn();
      const service = createService({
        reviewerClass: createFakeReviewerClass(result, onConstruct),
        settings: { modelId: "configured-model" },
      });

      await service.sendTask(request, "ghp_testtoken", "owner-1");
      await service.runPendingTasks();

      expect(onConstruct).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "configured-model" }),
      );
    });

    it("lets request modelId override the configured default", async () => {
      const onConstruct = vi.fn();
      const service = createService({
        reviewerClass: createFakeReviewerClass(result, onConstruct),
        settings: { modelId: "configured-model" },
      });

      await service.sendTask(
        {
          message: {
            role: "user",
            parts: [{ kind: "data", data: { prInfo, modelId: "request-model" } }],
          },
        },
        "ghp_testtoken",
        "owner-1",
      );
      await service.runPendingTasks();

      expect(onConstruct).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "request-model" }),
      );
    });

    it("returns null for unknown task ids", async () => {
      const service = createService({ reviewerClass: createFakeReviewerClass(result) });

      await expect(service.getTask("nonexistent-id", "owner-1")).resolves.toBeNull();
    });

    it("stores sanitized failures on the task", async () => {
      const reviewerClass: ReviewerClass = class FailingReviewer {
        async review(): Promise<ReviewResult> {
          throw new Error("request failed: Bearer ghp_secret");
        }
      };
      const store = new InMemoryReviewerTaskStore();
      const service = createService({ store, reviewerClass });

      const response = await service.sendTask(request, "ghp_testtoken", "owner-1");
      await service.runPendingTasks();

      const task = await store.get(response.task.id, "owner-1");
      expect(task?.status).toBe("failed");
      expect(task?.error).toBe("request failed: [REDACTED]");
    });
  },
);
