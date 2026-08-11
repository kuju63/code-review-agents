import { z } from "zod";

export const A2ATextPartSchema = z.object({
  kind: z.literal("text").default("text"),
  text: z.string(),
});
export type A2ATextPart = z.infer<typeof A2ATextPartSchema>;

export const A2ADataPartSchema = z.object({
  kind: z.literal("data").default("data"),
  data: z.record(z.string(), z.unknown()),
});
export type A2ADataPart = z.infer<typeof A2ADataPartSchema>;

const A2APartDiscriminatedSchema = z.discriminatedUnion("kind", [
  A2ATextPartSchema,
  A2ADataPartSchema,
]);

export const A2APartSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || "kind" in value) {
    return value;
  }
  if ("text" in value && typeof value.text === "string") {
    return { ...value, kind: "text" };
  }
  if ("data" in value && typeof value.data === "object" && value.data !== null) {
    return { ...value, kind: "data" };
  }
  return value;
}, A2APartDiscriminatedSchema);
export type A2APart = z.infer<typeof A2APartSchema>;

export const A2AMessageSchema = z.object({
  role: z.enum(["user", "agent"]),
  parts: z.array(A2APartSchema),
});
export type A2AMessage = z.infer<typeof A2AMessageSchema>;

export const A2ASendTaskRequestSchema = z.object({
  message: A2AMessageSchema,
});
export type A2ASendTaskRequest = z.infer<typeof A2ASendTaskRequestSchema>;

export const AuthorizationHeaderSchema = z.object({
  authorization: z.string(),
});
export type AuthorizationHeader = z.infer<typeof AuthorizationHeaderSchema>;

export const TaskParamsSchema = z.object({
  taskId: z.string(),
});
export type TaskParams = z.infer<typeof TaskParamsSchema>;

export const AgentCardHttpRequestSchema = z.object({});
export type AgentCardHttpRequest = z.infer<typeof AgentCardHttpRequestSchema>;

export const SendTaskHttpRequestSchema = z.object({
  headers: AuthorizationHeaderSchema,
  body: A2ASendTaskRequestSchema,
});
export type SendTaskHttpRequest = z.infer<typeof SendTaskHttpRequestSchema>;

export const GetTaskHttpRequestSchema = z.object({
  params: TaskParamsSchema,
});
export type GetTaskHttpRequest = z.infer<typeof GetTaskHttpRequestSchema>;
