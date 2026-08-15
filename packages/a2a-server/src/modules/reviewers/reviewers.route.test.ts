import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { GithubAuthEnv } from "../a2a/auth.middleware.js";
import type { ReviewerService } from "./reviewer-runtime.js";
import { createReviewersRoute } from "./reviewers.route.js";

const requestBody = {
  message: {
    role: "user",
    parts: [
      {
        kind: "data",
        data: {
          prInfo: {
            repositoryInfo: { owner: "octocat", repository: "hello" },
            projectSummary: "A project.",
            prInfo: { title: "Fix", prNumber: 1, body: "", labels: [], fileChanges: [] },
            dependencyFiles: [],
          },
        },
      },
    ],
  },
};

const authMiddleware: MiddlewareHandler<GithubAuthEnv> = async (c, next) => {
  c.set("githubToken", "ghp_testtoken");
  c.set("githubPrincipalId", "12345");
  await next();
};

const createService = (overrides: Partial<ReviewerService> = {}): ReviewerService =>
  ({
    getAgentCard: vi.fn(() => ({
      name: "React Reviewer",
      description:
        "Reviews React/TypeScript pull requests for component/Hook design, performance, and correct library usage.",
      url: "http://localhost/react-reviewer",
      version: "1.0.0",
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      inputModes: ["data"],
      outputModes: ["data"],
      skills: [],
    })),
    sendTask: vi.fn(async () => ({
      task: { id: "task-1", status: "submitted", message: null, error: null },
    })),
    getTask: vi.fn(async () => ({ id: "task-1", status: "completed", message: null, error: null })),
    runPendingTasks: vi.fn(async () => undefined),
    ...overrides,
  }) as ReviewerService;

describe("reviewer route", () => {
  it("registers the A2A endpoint trio", () => {
    const paths = [
      ...new Set(
        createReviewersRoute({ service: createService() }).routes.map((route) => route.path),
      ),
    ];

    expect(paths).toEqual(["/.well-known/agent.json", "/tasks/send", "/tasks/:taskId"]);
  });

  it("returns the service AgentCard", async () => {
    const service = createService();
    const app = createReviewersRoute({ service });

    const response = await app.request("/.well-known/agent.json");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "React Reviewer" });
    expect(service.getAgentCard).toHaveBeenCalledOnce();
  });

  it("returns 202 and delegates task submission to the service", async () => {
    const service = createService();
    const app = createReviewersRoute({ service, authMiddleware });

    const response = await app.request("/tasks/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ghp_testtoken" },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      task: { id: "task-1", status: "submitted", message: null, error: null },
    });
    expect(service.sendTask).toHaveBeenCalledWith(requestBody, "ghp_testtoken", "12345");
  });

  it("requires authentication to retrieve tasks", async () => {
    const service = createService();
    const app = createReviewersRoute({ service });

    const response = await app.request("/tasks/task-1");

    expect(response.status).toBe(401);
    expect(service.getTask).not.toHaveBeenCalled();
  });

  it("returns 404 when the service has no task", async () => {
    const service = createService({ getTask: vi.fn(async () => null) });
    const app = createReviewersRoute({ service, authMiddleware });

    const response = await app.request("/tasks/nonexistent-id", {
      headers: { Authorization: "Bearer ghp_testtoken" },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ detail: "Task not found" });
    expect(service.getTask).toHaveBeenCalledWith("nonexistent-id", "12345");
  });
});
