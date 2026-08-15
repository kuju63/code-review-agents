import { describe, expect, it } from "vitest";
import {
  A2ASendTaskResponseSchema,
  A2ATaskSchema,
  A2ATaskStatus,
  AgentCapabilitySchema,
  AgentCardSchema,
  GetTaskHttpResponseSchema,
  HttpErrorResponseSchema,
  HttpValidationErrorResponseSchema,
  SendTaskHttpResponseSchema,
} from "./response.model.js";

describe("A2A response models", () => {
  it("defines all task status values", () => {
    expect(A2ATaskStatus.options).toEqual(["submitted", "working", "completed", "failed"]);
  });

  it("applies task nullable defaults", () => {
    expect(A2ATaskSchema.parse({ id: "task-1", status: "submitted" })).toEqual({
      id: "task-1",
      status: "submitted",
      message: null,
      error: null,
    });
  });

  it("round-trips a send task response", () => {
    const response = A2ASendTaskResponseSchema.parse({
      task: { id: "task-1", status: "submitted" },
    });

    expect(A2ASendTaskResponseSchema.parse(JSON.parse(JSON.stringify(response)))).toEqual(response);
  });

  it("applies capability and AgentCard defaults", () => {
    expect(AgentCapabilitySchema.parse({})).toEqual({
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    });

    const card = AgentCardSchema.parse({
      name: "Reviewer",
      description: "Reviews code",
      url: "http://localhost/reviewer",
      skills: [
        {
          id: "review",
          name: "Review",
          description: "Reviews a pull request",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
      ],
    });

    expect(card.version).toBe("1.0.0");
    expect(card.inputModes).toEqual(["data"]);
    expect(card.outputModes).toEqual(["data"]);
  });

  it("models status-specific send and poll responses", () => {
    expect(
      SendTaskHttpResponseSchema.parse({
        status: 202,
        body: { task: { id: "task-1", status: "submitted" } },
      }),
    ).toMatchObject({ status: 202, body: { task: { id: "task-1" } } });
    expect(
      SendTaskHttpResponseSchema.parse({
        status: 401,
        body: { detail: "Invalid GitHub token" },
      }),
    ).toEqual({ status: 401, body: { detail: "Invalid GitHub token" } });
    expect(
      SendTaskHttpResponseSchema.parse({
        status: 422,
        body: { detail: [{ type: "missing", loc: ["body"], msg: "Field required" }] },
      }),
    ).toMatchObject({ status: 422 });
    expect(
      SendTaskHttpResponseSchema.parse({
        status: 503,
        body: { detail: "GitHub authentication endpoint is temporarily unreachable" },
      }),
    ).toMatchObject({ status: 503 });
    expect(
      GetTaskHttpResponseSchema.parse({
        status: 404,
        body: { detail: "Task not found" },
      }),
    ).toEqual({ status: 404, body: { detail: "Task not found" } });
  });

  it("models HTTP exception and validation error bodies", () => {
    expect(HttpErrorResponseSchema.parse({ detail: "Task not found" })).toEqual({
      detail: "Task not found",
    });
    expect(
      HttpValidationErrorResponseSchema.parse({
        detail: [
          {
            type: "missing",
            loc: ["header", "authorization"],
            msg: "Field required",
            input: null,
          },
        ],
      }),
    ).toEqual({
      detail: [
        {
          type: "missing",
          loc: ["header", "authorization"],
          msg: "Field required",
          input: null,
        },
      ],
    });
  });
});
