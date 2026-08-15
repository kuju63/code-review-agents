import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { GithubAuthEnv } from "../a2a/auth.middleware.js";
import { createPrInfoRoute } from "./pr-info.route.js";
import type { PrInfoService } from "./pr-info.service.js";

const requestBody = {
  message: {
    role: "user",
    parts: [{ kind: "data", data: { owner: "octocat", repo: "hello", prNumber: 1 } }],
  },
};

const createService = (overrides: Partial<PrInfoService> = {}): PrInfoService =>
  ({
    getAgentCard: vi.fn(() => ({
      name: "PR Info Collector",
      description:
        "Collects pull request information from GitHub and returns structured data for downstream review agents.",
      url: "http://localhost/pr-info-collector",
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
  }) as PrInfoService;

describe("PR Info route", () => {
  it("returns the service AgentCard", async () => {
    const service = createService();
    const app = createPrInfoRoute({ service });

    const response = await app.request("/.well-known/agent.json");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "PR Info Collector" });
    expect(service.getAgentCard).toHaveBeenCalledOnce();
  });

  it("returns 202 and delegates task submission to the service", async () => {
    const service = createService();
    const authMiddleware: MiddlewareHandler<GithubAuthEnv> = async (c, next) => {
      c.set("githubToken", "ghp_testtoken");
      await next();
    };
    const app = createPrInfoRoute({
      service,
      authMiddleware,
    });

    const response = await app.request("/tasks/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ghp_testtoken" },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      task: { id: "task-1", status: "submitted", message: null, error: null },
    });
    expect(service.sendTask).toHaveBeenCalledWith(requestBody, "ghp_testtoken");
  });

  it("returns 404 when the service has no task", async () => {
    const service = createService({ getTask: vi.fn(async () => null) });
    const app = createPrInfoRoute({ service });

    const response = await app.request("/tasks/nonexistent-id");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ detail: "Task not found" });
    expect(service.getTask).toHaveBeenCalledWith("nonexistent-id");
  });
});
