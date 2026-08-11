import { describe, expect, it } from "vitest";
import {
  A2ADataPartSchema,
  A2AMessageSchema,
  A2ASendTaskRequestSchema,
  A2ATextPartSchema,
  AuthorizationHeaderSchema,
  TaskParamsSchema,
} from "./request.model.js";

describe("A2A request models", () => {
  it("applies text and data part defaults", () => {
    expect(A2ATextPartSchema.parse({ text: "hello" })).toEqual({ kind: "text", text: "hello" });
    expect(A2ADataPartSchema.parse({ data: { prNumber: 1 } })).toEqual({
      kind: "data",
      data: { prNumber: 1 },
    });
  });

  it("applies part defaults inside a message", () => {
    expect(
      A2AMessageSchema.parse({
        role: "user",
        parts: [{ text: "review" }, { data: { owner: "octo" } }, { text: null, data: {} }],
      }).parts,
    ).toEqual([
      { kind: "text", text: "review" },
      { kind: "data", data: { owner: "octo" } },
      { kind: "data", data: {} },
    ]);
  });

  it("discriminates message parts by kind", () => {
    const message = A2AMessageSchema.parse({
      role: "user",
      parts: [
        { kind: "text", text: "review" },
        { kind: "data", data: { owner: "octo" } },
      ],
    });

    expect(message.parts[0]).toEqual({ kind: "text", text: "review" });
    expect(message.parts[1]).toEqual({ kind: "data", data: { owner: "octo" } });
  });

  it("round-trips a send task request", () => {
    const request = A2ASendTaskRequestSchema.parse({
      message: { role: "user", parts: [{ kind: "data", data: { prNumber: 1 } }] },
    });

    expect(A2ASendTaskRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
  });

  it("models headers and camelCase path parameters", () => {
    expect(AuthorizationHeaderSchema.parse({ authorization: "Bearer token" })).toEqual({
      authorization: "Bearer token",
    });
    expect(TaskParamsSchema.parse({ taskId: "task-1" })).toEqual({ taskId: "task-1" });
  });
});
