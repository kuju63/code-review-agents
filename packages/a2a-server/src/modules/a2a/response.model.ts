import { z } from "zod";
import { A2AMessageSchema } from "./request.model.js";

export const A2ATaskStatus = z.enum({
  SUBMITTED: "submitted",
  WORKING: "working",
  COMPLETED: "completed",
  FAILED: "failed",
});
export type A2ATaskStatus = z.infer<typeof A2ATaskStatus>;

export const A2ATaskSchema = z.object({
  id: z.string(),
  status: A2ATaskStatus,
  message: A2AMessageSchema.nullable().default(null),
  error: z.string().nullable().default(null),
});
export type A2ATask = z.infer<typeof A2ATaskSchema>;

export const A2ASendTaskResponseSchema = z.object({
  task: A2ATaskSchema,
});
export type A2ASendTaskResponse = z.infer<typeof A2ASendTaskResponseSchema>;

export const AgentCapabilitySchema = z.object({
  streaming: z.boolean().default(false),
  pushNotifications: z.boolean().default(false),
  stateTransitionHistory: z.boolean().default(false),
});
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

const JsonSchemaSchema = z.record(z.string(), z.unknown());

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  inputSchema: JsonSchemaSchema,
  outputSchema: JsonSchemaSchema,
});
export type AgentSkill = z.infer<typeof AgentSkillSchema>;

export const AgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string(),
  version: z.string().default("1.0.0"),
  capabilities: AgentCapabilitySchema.default({
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  }),
  inputModes: z.array(z.string()).default(["data"]),
  outputModes: z.array(z.string()).default(["data"]),
  skills: z.array(AgentSkillSchema),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;

export const HttpErrorResponseSchema = z.object({
  detail: z.string(),
});
export type HttpErrorResponse = z.infer<typeof HttpErrorResponseSchema>;

export const UnauthorizedResponseSchema = HttpErrorResponseSchema;
export type UnauthorizedResponse = z.infer<typeof UnauthorizedResponseSchema>;

export const BadRequestResponseSchema = HttpErrorResponseSchema;
export type BadRequestResponse = z.infer<typeof BadRequestResponseSchema>;

export const NotFoundResponseSchema = HttpErrorResponseSchema;
export type NotFoundResponse = z.infer<typeof NotFoundResponseSchema>;

export const ServiceUnavailableResponseSchema = HttpErrorResponseSchema;
export type ServiceUnavailableResponse = z.infer<typeof ServiceUnavailableResponseSchema>;

export const HttpValidationErrorSchema = z.object({
  type: z.string(),
  loc: z.array(z.union([z.string(), z.number().int()])),
  msg: z.string(),
  input: z.unknown().optional(),
  ctx: z.record(z.string(), z.unknown()).optional(),
});
export type HttpValidationError = z.infer<typeof HttpValidationErrorSchema>;

export const HttpValidationErrorResponseSchema = z.object({
  detail: z.array(HttpValidationErrorSchema),
});
export type HttpValidationErrorResponse = z.infer<typeof HttpValidationErrorResponseSchema>;

export const AgentCardHttpResponseSchema = z.object({
  status: z.literal(200),
  body: AgentCardSchema,
});
export type AgentCardHttpResponse = z.infer<typeof AgentCardHttpResponseSchema>;

export const SendTaskHttpResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal(202), body: A2ASendTaskResponseSchema }),
  z.object({ status: z.literal(400), body: BadRequestResponseSchema }),
  z.object({ status: z.literal(401), body: UnauthorizedResponseSchema }),
  z.object({ status: z.literal(422), body: HttpValidationErrorResponseSchema }),
  z.object({ status: z.literal(503), body: ServiceUnavailableResponseSchema }),
]);
export type SendTaskHttpResponse = z.infer<typeof SendTaskHttpResponseSchema>;

export const GetTaskHttpResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal(200), body: A2ATaskSchema }),
  z.object({ status: z.literal(401), body: UnauthorizedResponseSchema }),
  z.object({ status: z.literal(404), body: NotFoundResponseSchema }),
  z.object({ status: z.literal(503), body: ServiceUnavailableResponseSchema }),
]);
export type GetTaskHttpResponse = z.infer<typeof GetTaskHttpResponseSchema>;
