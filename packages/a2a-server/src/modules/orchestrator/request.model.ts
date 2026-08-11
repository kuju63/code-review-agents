import { z } from "zod";

export const FullReviewInputSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().int(),
  modelId: z.string().default("gpt-4o"),
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
