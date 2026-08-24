import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { GithubAuthEnv } from "../a2a/auth.middleware.js";
import { createOrchestratorRoute } from "./orchestrator.route.js";
import { InMemoryOrchestratorTaskStore, type OrchestratorService } from "./orchestrator.service.js";

const requestBody = {
  message: {
    role: "user",
    parts: [{ kind: "data", data: { owner: "octocat", repo: "hello", prNumber: 1 } }],
  },
};

const authMiddleware: MiddlewareHandler<GithubAuthEnv> = async (c, next) => {
  c.set("githubToken", "ghp_testtoken");
  c.set("githubPrincipalId", "12345");
  await next();
};

const createService = (overrides: Partial<OrchestratorService> = {}): OrchestratorService =>
  ({
    getAgentCard: vi.fn(() => ({
      name: "Orchestrator",
      description:
        "Runs the full 3-stage code review pipeline: PR info collection, parallel review, and lead engineer synthesis.",
      url: "http://localhost/orchestrator",
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
  }) as OrchestratorService;

describe("Orchestrator route", () => {
  it("registers the A2A endpoint trio", () => {
    const paths = [
      ...new Set(
        createOrchestratorRoute({ service: createService() }).routes.map((route) => route.path),
      ),
    ];

    expect(paths).toEqual(["/.well-known/agent.json", "/tasks/send", "/tasks/:taskId"]);
  });

  it("returns the service AgentCard", async () => {
    const service = createService();
    const app = createOrchestratorRoute({ service });

    const response = await app.request("/.well-known/agent.json");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Orchestrator" });
    expect(service.getAgentCard).toHaveBeenCalledOnce();
  });

  it("returns 202 and delegates task submission to the service", async () => {
    const service = createService();
    const app = createOrchestratorRoute({ service, authMiddleware });

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
    const app = createOrchestratorRoute({ service });

    const response = await app.request("/tasks/task-1");

    expect(response.status).toBe(401);
    expect(service.getTask).not.toHaveBeenCalled();
  });

  it("returns 404 when the service has no task", async () => {
    const service = createService({ getTask: vi.fn(async () => null) });
    const app = createOrchestratorRoute({ service, authMiddleware });

    const response = await app.request("/tasks/nonexistent-id", {
      headers: { Authorization: "Bearer ghp_testtoken" },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ detail: "Task not found" });
    expect(service.getTask).toHaveBeenCalledWith("nonexistent-id", "12345");
  });

  it("derives the task owner from the authenticated principal, not client input", async () => {
    const store = new InMemoryOrchestratorTaskStore();
    const owned = await store.create("owner-1");
    const service = createService({
      getTask: vi.fn((taskId, ownerPrincipalId) => store.get(taskId, ownerPrincipalId)),
    });

    const asOwner: MiddlewareHandler<GithubAuthEnv> = async (c, next) => {
      c.set("githubToken", "ghp_owner");
      c.set("githubPrincipalId", "owner-1");
      await next();
    };
    const asOther: MiddlewareHandler<GithubAuthEnv> = async (c, next) => {
      c.set("githubToken", "ghp_other");
      c.set("githubPrincipalId", "owner-2");
      await next();
    };

    const ownerApp = createOrchestratorRoute({ service, authMiddleware: asOwner });
    const ownerResponse = await ownerApp.request(`/tasks/${owned.id}`, {
      headers: { Authorization: "Bearer ghp_owner", "x-owner-principal-id": "owner-2" },
    });
    expect(ownerResponse.status).toBe(200);
    expect(service.getTask).toHaveBeenCalledWith(owned.id, "owner-1");

    const otherApp = createOrchestratorRoute({ service, authMiddleware: asOther });
    const otherResponse = await otherApp.request(`/tasks/${owned.id}`, {
      headers: { Authorization: "Bearer ghp_other", "x-owner-principal-id": "owner-1" },
    });
    expect(otherResponse.status).toBe(404);
    expect(service.getTask).toHaveBeenLastCalledWith(owned.id, "owner-2");
  });
});
