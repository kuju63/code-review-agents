import { z } from "zod";

export const FullReviewInputSchema = z.object({
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  prNumber: z.number().int().positive(),
  modelId: z.string().trim().min(1).optional(),
});
export type FullReviewInput = z.infer<typeof FullReviewInputSchema>;

export type {
  AgentCardHttpRequest as OrchestratorAgentCardRequest,
  GetTaskHttpRequest as OrchestratorGetTaskRequest,
  SendTaskHttpRequest as OrchestratorSendTaskRequest,
} from "../a2a/request.model.js";
export {
  AgentCardHttpRequestSchema as OrchestratorAgentCardRequestSchema,
  GetTaskHttpRequestSchema as OrchestratorGetTaskRequestSchema,
  SendTaskHttpRequestSchema as OrchestratorSendTaskRequestSchema,
} from "../a2a/request.model.js";
