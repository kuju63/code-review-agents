import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { GithubAuthEnv } from "../a2a/auth.middleware.js";
import { createLeadEngineerRoute } from "./lead-engineer.route.js";
import type { LeadEngineerService } from "./lead-engineer.service.js";

const requestBody = {
  message: {
    role: "user",
    parts: [
      {
        kind: "data",
        data: {
          reviewReport: {
            results: [],
            errors: [],
          },
        },
      },
    ],
  },
};

const createService = (overrides: Partial<LeadEngineerService> = {}): LeadEngineerService =>
  ({
    getAgentCard: vi.fn(() => ({
      name: "Lead Engineer",
      description:
        "Evaluates reviewer findings and produces final accept/reject decisions for each issue.",
      url: "http://localhost/lead-engineer",
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
  }) as LeadEngineerService;

describe("Lead Engineer route", () => {
  it("registers the A2A endpoint trio", () => {
    const paths = [
      ...new Set(
        createLeadEngineerRoute({ service: createService() }).routes.map((route) => route.path),
      ),
    ];

    expect(paths).toEqual(["/.well-known/agent.json", "/tasks/send", "/tasks/:taskId"]);
  });

  it("returns the service AgentCard", async () => {
    const service = createService();
    const app = createLeadEngineerRoute({ service });

    const response = await app.request("/.well-known/agent.json");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Lead Engineer" });
    expect(service.getAgentCard).toHaveBeenCalledOnce();
  });

  it("returns 202 and delegates task submission to the service", async () => {
    const service = createService();
    const authMiddleware: MiddlewareHandler<GithubAuthEnv> = async (c, next) => {
      c.set("githubToken", "ghp_testtoken");
      await next();
    };
    const app = createLeadEngineerRoute({ service, authMiddleware });

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
    const app = createLeadEngineerRoute({ service });

    const response = await app.request("/tasks/nonexistent-id");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ detail: "Task not found" });
    expect(service.getTask).toHaveBeenCalledWith("nonexistent-id");
  });
});
